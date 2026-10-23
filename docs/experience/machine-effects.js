/* Source-mounted effects. No timers, renderer, audio, global materials or DOM ownership. */
(function (root) {
  'use strict';
  root.createMachineEffects = function createMachineEffects(options) {
    const {THREE, model} = options;
    if (!THREE || !model) throw new Error('createMachineEffects requires THREE and model');
    const count = Math.max(8, Math.min(96, Math.floor(options.particleCount || 80)));
    const gauges = [], lamps = [], outlets = [], valves = [], overlays = [];
    const axis = new THREE.Vector3(0, 0, 1), turn = new THREE.Quaternion();
    const state = {disposed:false, activeParticles:0, pressure:0.48, simulatedSeconds:0};
    model.updateWorldMatrix(true, true);
    const inverse = new THREE.Matrix4().copy(model.matrixWorld).invert();
    const bounds = new THREE.Box3(), box = new THREE.Box3(), matrix = new THREE.Matrix4();
    model.traverse(object => {
      if (!object.isMesh || !object.geometry || object.userData.wallAnimationEffect) return;
      if (!object.geometry.boundingBox) object.geometry.computeBoundingBox();
      matrix.multiplyMatrices(inverse, object.matrixWorld);
      bounds.union(box.copy(object.geometry.boundingBox).applyMatrix4(matrix));
    });
    const height = bounds.isEmpty() ? 1 : Math.max(.01, bounds.max.y - bounds.min.y);
    function mountOutlet(object, fallback) {
      const position = new THREE.Vector3();
      object.getWorldPosition(position).applyMatrix4(inverse);
      // Explicit outlets sit exactly at the source pipe opening. Legacy valve fallback
      // offsets toward its packing joint, avoiding a plume through the wheel centre.
      if (fallback) { position.x += height * .013; position.y -= height * .012; position.z += height * .006; }
      const raw = object.userData.steam_direction;
      const direction = Array.isArray(raw) && raw.length === 3 && raw.every(Number.isFinite)
        ? new THREE.Vector3(raw[0],raw[1],raw[2]) : new THREE.Vector3(fallback ? .7 : .3, 1, .25);
      if (direction.lengthSq() < 1e-8) direction.set(.3,1,.25);
      // Directions are expressed in the outlet's local coordinates.
      if (raw) direction.transformDirection(matrix.multiplyMatrices(inverse, object.matrixWorld));
      direction.normalize();
      outlets.push({position, direction, phase:outlets.length * 1.73, credit:0, explicit:!fallback});
    }
    model.traverse(object => {
      const data = object.userData || {}, role = data.animation_role;
      if (role === 'pressure_needle') gauges.push({object,base:object.quaternion.clone(),index:gauges.length,
        reference:Number.isFinite(data.reference_pressure) ? data.reference_pressure : .48,
        sweep:Number.isFinite(data.gauge_sweep_radians) ? data.gauge_sweep_radians : Math.PI * 1.35});
      if (role === 'pressure_gauge' && data.gauge_needle_overlay === true && Number(data.gauge_radius) > 0) {
        // This opt-in is valid only for a clean dial with the original needle removed.
        const radius = data.gauge_radius;
        const needle = new THREE.Mesh(new THREE.ConeGeometry(radius*.035,radius*.7,5),
          new THREE.MeshStandardMaterial({color:0x391b13,roughness:.38,metalness:.6}));
        needle.position.set(0,radius*.30,radius*.012);
        const pivot = new THREE.Group(); pivot.name = 'CleanDial_PressureNeedle'; pivot.add(needle); object.add(pivot);
        overlays.push(pivot);
        gauges.push({object:pivot,base:pivot.quaternion.clone(),index:gauges.length,reference:.48,sweep:Math.PI*1.35});
      }
      if ((role === 'lamp' || data.lamp_role) && object.isMesh && object.material) {
        const original = object.material;
        const originals = Array.isArray(original) ? original : [original];
        const clones = originals.map(material => material.clone());
        object.material = Array.isArray(original) ? clones : clones[0];
        for (const material of clones) {
          if (material.emissive) material.emissive.set(data.lamp_color || 0xff9b36);
          // Explicitly isolated bulb/lens geometry can glow independently of a black atlas.
          if (data.lamp_emission_unmapped === true) material.emissiveMap = null;
          material.emissiveIntensity = Number.isFinite(data.lamp_intensity) ? data.lamp_intensity : 1.1;
        }
        lamps.push({object,original,clones,index:lamps.length});
      }
      if (role === 'steam_outlet') mountOutlet(object, false);
      if (role === 'valve_wheel') valves.push(object);
    });
    // No arbitrary floating outlets on models without source metadata.
    if (!outlets.length) for (const valve of valves) mountOutlet(valve, true);

    const positions = new Float32Array(count*3), sizes = new Float32Array(count), alphas = new Float32Array(count);
    const ages = new Float32Array(count), lives = new Float32Array(count), velocities = new Float32Array(count*3);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.BufferAttribute(positions,3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('puffSize',new THREE.BufferAttribute(sizes,1).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('puffAlpha',new THREE.BufferAttribute(alphas,1).setUsage(THREE.DynamicDrawUsage));
    geometry.setDrawRange(0,0);
    const material = new THREE.ShaderMaterial({transparent:true,depthWrite:false,depthTest:true,
      uniforms:{pixelScale:{value:Math.max(1,Number(options.pixelScale)||700)}},
      vertexShader:'attribute float puffSize; attribute float puffAlpha; uniform float pixelScale; varying float vAlpha; varying float vSeed; void main(){vec4 p=modelViewMatrix*vec4(position,1.);gl_Position=projectionMatrix*p;gl_PointSize=clamp(puffSize*pixelScale/max(.05,-p.z),1.,96.);vAlpha=puffAlpha;vSeed=position.x*183.7+position.y*97.1;}',
      fragmentShader:'varying float vAlpha; varying float vSeed; void main(){vec2 uv=gl_PointCoord-vec2(.5);float r=length(uv)*2.;if(r>=1.||vAlpha<.001)discard;float edge=1.-smoothstep(.05,1.,r);float cloud=.78+.22*sin(uv.x*15.+vSeed)*sin(uv.y*17.+vSeed);gl_FragColor=vec4(.88,.91,.93,edge*edge*cloud*vAlpha);}'
    });
    const steam = new THREE.Points(geometry,material); steam.name = 'MachineEffects_Leaks';
    steam.userData.wallAnimationEffect = true; steam.frustumCulled = false; steam.visible = false; model.add(steam);
    let cursor=0, serial=0, pressureVelocity=0, wasBoost=false;
    const fract = value => value-Math.floor(value);
    function clearSteam() {
      lives.fill(0); sizes.fill(0); alphas.fill(0); state.activeParticles=0;
      geometry.setDrawRange(0,0); steam.visible=false;
      for (const outlet of outlets) outlet.credit=0;
    }
    function reset() {
      if (state.disposed) return;
      clearSteam(); state.pressure=.48; state.simulatedSeconds=0; pressureVelocity=0; wasBoost=false;
      for (const gauge of gauges) gauge.object.quaternion.copy(gauge.base);
      for (const lamp of lamps) for (const clone of lamp.clones) clone.emissiveIntensity=Number.isFinite(lamp.object.userData.lamp_intensity) ? lamp.object.userData.lamp_intensity : 1.1;
    }
    function emit(outlet, boost) {
      // A deterministic pool makes regression checks repeatable, with no per-frame allocation.
      const slot=cursor, offset=slot*3; cursor=(cursor+1)%count; serial++;
      const variation=fract(serial*.61803398875), spread=(variation-.5)*height*.015;
      positions[offset]=outlet.position.x; positions[offset+1]=outlet.position.y; positions[offset+2]=outlet.position.z;
      const speed=height*(boost ? .105 : .06);
      velocities[offset]=outlet.direction.x*speed+spread;
      velocities[offset+1]=outlet.direction.y*speed;
      velocities[offset+2]=outlet.direction.z*speed;
      ages[slot]=0; lives[slot]=1.15+variation*.9; sizes[slot]=height*.008; alphas[slot]=0;
    }
    function update(deltaMs, nowMs, animationState) {
      if (state.disposed) return;
      const input=animationState || {}, dt=Number.isFinite(deltaMs) ? Math.min(.1,Math.max(0,deltaMs/1000)) : 0;
      if (input.reducedMotion || input.tracked === false) { reset(); return; }
      if (!input.running) { if (!input.elapsed) reset(); else clearSteam(); return; }
      state.simulatedSeconds+=dt;
      const t=state.simulatedSeconds, boost=!!input.overdrive;
      const target=(boost ? .82 : .48)+Math.sin(t*.83)*.045+Math.sin(t*2.1)*.012;
      // Critically damped regulator response; release follows the same pressure as gauges.
      pressureVelocity+=(20*(target-state.pressure)-9*pressureVelocity)*dt;
      state.pressure=Math.max(.12,Math.min(.94,state.pressure+pressureVelocity*dt));
      for (const gauge of gauges) {
        const pressure=Math.max(0,Math.min(1,state.pressure+Math.sin(t*1.5+gauge.index)*.012));
        turn.setFromAxisAngle(axis,-(pressure-gauge.reference)*gauge.sweep);
        gauge.object.quaternion.copy(gauge.base).multiply(turn);
      }
      for (const lamp of lamps) {
        const phase=t*2*Math.PI/(boost ? 1.2 : 3.8)+lamp.index*1.1;
        const pulse=boost ? .35+.65*Math.pow(.5+.5*Math.sin(phase),3) : .8+.2*Math.sin(phase);
        const base=Number.isFinite(lamp.object.userData.lamp_intensity) ? lamp.object.userData.lamp_intensity : 1.1;
        for (const clone of lamp.clones) clone.emissiveIntensity=base*(boost ? 2.2 : 1)*pulse;
      }
      for (const outlet of outlets) {
        // Brief packing leaks every few seconds, staggered across real source joints.
        const releasing=boost || ((t+outlet.phase)%4.9 < 1.25);
        if (boost && !wasBoost) for(let i=0;i<5;i++) emit(outlet,true);
        if (releasing) {
          outlet.credit+=dt*(boost ? 15 : 8);
          while(outlet.credit>=1) { emit(outlet,boost); outlet.credit--; }
        } else outlet.credit=0;
      }
      wasBoost=boost; let active=0;
      for(let i=0;i<count;i++) {
        if(lives[i]<=0) continue;
        ages[i]+=dt; const life=ages[i]/lives[i];
        if(life>=1) {lives[i]=0;alphas[i]=0;sizes[i]=0;continue;}
        active++; const offset=i*3;
        positions[offset]+=velocities[offset]*dt;
        velocities[offset+1]+=height*.018*dt;
        positions[offset+1]+=velocities[offset+1]*dt;
        positions[offset+2]+=velocities[offset+2]*dt;
        sizes[i]=height*(.01+life*.055);
        alphas[i]=(boost ? .29 : .2)*Math.sin(Math.PI*life)*Math.min(1,life*9);
      }
      state.activeParticles=active;
      geometry.attributes.position.needsUpdate=true;geometry.attributes.puffSize.needsUpdate=true;geometry.attributes.puffAlpha.needsUpdate=true;
      geometry.setDrawRange(0,active ? count : 0); steam.visible=active>0;
    }
    return {steam,state,update,reset,
      getDiagnostics() {return {gaugeCount:gauges.length,lampCount:lamps.length,outletCount:outlets.length,
        fallbackOutlets:outlets.some(o=>!o.explicit),
        particleCapacity:count,activeParticles:state.activeParticles,pressure:state.pressure,disposed:state.disposed};},
      dispose() {
        if(state.disposed)return;reset();state.disposed=true;
        steam.removeFromParent();geometry.dispose();material.dispose();
        for(const lamp of lamps){lamp.object.material=lamp.original;for(const clone of lamp.clones)clone.dispose();}
        for(const pivot of overlays){pivot.traverse(child=>{if(child.isMesh){child.geometry.dispose();child.material.dispose();}});pivot.removeFromParent();}
      }
    };
  };
})(typeof window!=='undefined' ? window : globalThis);
