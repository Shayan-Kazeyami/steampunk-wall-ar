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
    let steamEnabled=true;
    // Angles measured from the actual 0–30 artwork, not an assumed uniform sweep.
    const printedValues=[0,5,10,15,20,25,30];
    const printedAngles=[235.3142857143,192.4,142.9333333333,92.15,41,-9,-59.8];
    function addGauge(object,data) {
      const known=/Steam[ _]Pressure[ _]Gauge\.?03[345]_Needle/.test(object.name);
      const values=Array.isArray(data.gauge_tick_values)?data.gauge_tick_values:(known?printedValues:null);
      const angles=Array.isArray(data.gauge_tick_angles)?data.gauge_tick_angles:(known?printedAngles:null);
      const calibrated=!!(values && angles && values.length>=2 && values.length===angles.length && values.every(Number.isFinite) && angles.every(Number.isFinite) && values.every((v,i)=>!i || v>values[i-1]));
      const index=gauges.length;
      gauges.push({object,base:object.quaternion.clone(),index,values,angles,calibrated,
        sourceAngle:Number.isFinite(data.gauge_source_angle_degrees)?data.gauge_source_angle_degrees:-41.54468349,
        value:calibrated?values[values.length-1]:0,target:calibrated?values[values.length-1]:0,override:null,
        idle:Number.isFinite(data.gauge_idle_value)?data.gauge_idle_value:[12,15,18][index%3],
        boost:Number.isFinite(data.gauge_boost_value)?data.gauge_boost_value:[24,27,29][index%3],
        response:Number.isFinite(data.gauge_response_seconds)?Math.max(.1,data.gauge_response_seconds):[.9,1.2,1.5][index%3]});
    }
    function applyGauge(gauge) {
      if(!gauge.calibrated){gauge.object.quaternion.copy(gauge.base);return;}
      const last=gauge.values.length-1;
      const value=Math.max(gauge.values[0],Math.min(gauge.values[last],gauge.value));
      let i=0;while(i<last-1 && value>gauge.values[i+1])i++;
      const fraction=(value-gauge.values[i])/(gauge.values[i+1]-gauge.values[i]);
      gauge.angle=gauge.angles[i]+fraction*(gauge.angles[i+1]-gauge.angles[i]);
      turn.setFromAxisAngle(axis,(gauge.angle-gauge.sourceAngle)*Math.PI/180);
      gauge.object.quaternion.copy(gauge.base).multiply(turn);
    }
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
      if (role === 'pressure_needle') addGauge(object,data);
      if (role === 'pressure_gauge' && data.gauge_needle_overlay === true && Number(data.gauge_radius) > 0) {
        // This opt-in is valid only for a clean dial with the original needle removed.
        const radius = data.gauge_radius;
        const needle = new THREE.Mesh(new THREE.ConeGeometry(radius*.035,radius*.7,5),
          new THREE.MeshStandardMaterial({color:0x391b13,roughness:.38,metalness:.6}));
        needle.position.set(0,radius*.30,radius*.012);
        const pivot = new THREE.Group(); pivot.name = 'CleanDial_PressureNeedle'; pivot.add(needle); object.add(pivot);
        overlays.push(pivot);
        addGauge(pivot,data);
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
    for(const gauge of gauges)applyGauge(gauge);

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
      for (const gauge of gauges) {
        gauge.override=null;gauge.value=gauge.target=gauge.calibrated?gauge.values[gauge.values.length-1]:0;applyGauge(gauge);
      }
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
      const target=boost ? .82 : .48;
      // Critically damped regulator response; release follows the same pressure as gauges.
      pressureVelocity+=(20*(target-state.pressure)-9*pressureVelocity)*dt;
      state.pressure=Math.max(.12,Math.min(.94,state.pressure+pressureVelocity*dt));
      for (const gauge of gauges) {
        if(!gauge.calibrated)continue;
        gauge.target=Math.max(gauge.values[0],Math.min(gauge.values[gauge.values.length-1],gauge.override===null?(boost?gauge.boost:gauge.idle):gauge.override));
        gauge.value+=(gauge.target-gauge.value)*(1-Math.exp(-dt/gauge.response));
        applyGauge(gauge);
      }
      for (const lamp of lamps) {
        const phase=t*2*Math.PI/(boost ? 1.2 : 3.8)+lamp.index*1.1;
        const pulse=boost ? .35+.65*Math.pow(.5+.5*Math.sin(phase),3) : .8+.2*Math.sin(phase);
        const base=Number.isFinite(lamp.object.userData.lamp_intensity) ? lamp.object.userData.lamp_intensity : 1.1;
        for (const clone of lamp.clones) clone.emissiveIntensity=base*(boost ? 2.2 : 1)*pulse;
      }
      if(steamEnabled) for (const outlet of outlets) {
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
      setSteamEnabled(value) {if(state.disposed)return;steamEnabled=!!value;if(!steamEnabled)clearSteam();},
      setGaugeValue(name,value) {
        const gauge=gauges.find(g=>g.object.name===name);
        if(state.disposed || !gauge?.calibrated || !Number.isFinite(value))return false;
        gauge.override=Math.max(gauge.values[0],Math.min(gauge.values[gauge.values.length-1],value));return true;
      },
      getDiagnostics() {return {gaugeCount:gauges.length,lampCount:lamps.length,outletCount:outlets.length,
        fallbackOutlets:outlets.some(o=>!o.explicit),
        gauges:gauges.map(g=>({name:g.object.name,calibrated:g.calibrated,value:g.value,target:g.target,angleDegrees:g.angle,scale:g.calibrated?[g.values[0],g.values[g.values.length-1]]:null})),
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
