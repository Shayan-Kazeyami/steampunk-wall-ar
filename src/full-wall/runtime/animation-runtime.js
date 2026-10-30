/* Source-derived wall animation. No renderer, timers, model loading or global material edits. */
export const createWallAnimation = (function (root) {
  'use strict';
  return function createWallAnimation(options) {
    const {THREE, model} = options;
    if (!THREE || !model) throw new Error('createWallAnimation requires THREE and model');
    const count = Math.max(1, Math.min(96, Math.floor(options.particleCount || 48)));
    const state = {running: false, reducedMotion: false, tracked: true, disposed: false,
      overdrive: false, overdriveUntil: 0, gearCount: 0, valveCount: 0,
      activeParticles: 0, elapsed: 0, steamEnabled: true, startup:0, releaseRemaining:0, valveTurns:0,
      gearContacts: [], gearComponents: [], gearConflicts: [], gearDrives: []};
    const parts = [], axis = new THREE.Vector3(0, 0, 1), rotation = new THREE.Quaternion();
    model.traverse(object => {
      const role = object.userData && object.userData.animation_role;
      if (role !== 'gear' && role !== 'valve_wheel' && role !== 'control_handle') return;
      const index = role === 'gear' ? state.gearCount++ : role === 'valve_wheel' ? state.valveCount++ : 0;
      parts.push({object, role, index, base: object.quaternion.clone(),turnRemaining:0});
    });

    // Compute model-local bounds once, including nested transformed meshes.
    model.updateWorldMatrix(true, true);
    const inverse = new THREE.Matrix4().copy(model.matrixWorld).invert();
    const bounds = new THREE.Box3(), scratch = new THREE.Box3(), matrix = new THREE.Matrix4();
    model.traverse(object => {
      if (!object.isMesh || !object.geometry) return;
      if (!object.geometry.boundingBox) object.geometry.computeBoundingBox();
      matrix.multiplyMatrices(inverse, object.matrixWorld);
      scratch.copy(object.geometry.boundingBox).applyMatrix4(matrix);
      bounds.union(scratch);
    });
    if (bounds.isEmpty()) bounds.set(new THREE.Vector3(-.5,-.22,0), new THREE.Vector3(.5,.22,.08));
    // Infer external gear contact from existing geometry, without inventing shafts or belts.
    // Outer bounds include tooth tips, so these are approximate pitch radii. Preserve
    // authored starting phases: source meshes do not provide reliable tooth counts.
    const gears = parts.filter(part => part.role === 'gear');
    const point = new THREE.Vector3();
    for (const part of gears) {
      const box = new THREE.Box3();
      part.object.traverse(object => {
        if (!object.isMesh || !object.geometry || object.userData.debugWireOverlay) return;
        if (!object.geometry.boundingBox) object.geometry.computeBoundingBox();
        matrix.multiplyMatrices(inverse, object.matrixWorld);
        box.union(scratch.copy(object.geometry.boundingBox).applyMatrix4(matrix));
      });
      part.object.getWorldPosition(point).applyMatrix4(inverse);
      const valid = !box.isEmpty();
      const radius = valid ? Math.max(1e-6, ((box.max.x-box.min.x)+(box.max.y-box.min.y))/4) : 1e-6;
      part.drive = {index:part.index, name:part.object.name, x:point.x, y:point.y,
        radius, zMin:valid?box.min.z:point.z, zMax:valid?box.max.z:point.z,
        valid, component:-1, sign:0, angularSpeed:0};
      state.gearDrives.push(part.drive);
    }
    const adjacent = gears.map(() => []);
    for (let a=0;a<gears.length;a++) for (let b=a+1;b<gears.length;b++) {
      const ga=gears[a].drive,gb=gears[b].drive;
      if (!ga.valid || !gb.valid) continue;
      const distance=Math.hypot(ga.x-gb.x,ga.y-gb.y), sum=ga.radius+gb.radius;
      const ratio=distance/sum;
      // Reject concentric/overlapping gears and gears on separated depth planes.
      const depthOverlap=Math.min(ga.zMax,gb.zMax)-Math.max(ga.zMin,gb.zMin);
      if(ratio<.90 || ratio>1.065 || depthOverlap < -Math.min(ga.radius,gb.radius)*.06) continue;
      state.gearContacts.push({a,b,distance,radiusSum:sum,ratio,inferred:true});
      adjacent[a].push(b); adjacent[b].push(a);
    }
    for(let start=0;start<gears.length;start++) {
      if(gears[start].drive.component>=0) continue;
      const component={id:state.gearComponents.length,gears:[],contactCount:0,conflicted:false};
      const queue=[start];
      gears[start].drive.component=component.id;gears[start].drive.sign=1;
      for(let q=0;q<queue.length;q++) {
        const a=queue[q],ga=gears[a].drive; component.gears.push(a);
        for(const b of adjacent[a]) {
          const gb=gears[b].drive;
          if(gb.component<0) {gb.component=component.id;gb.sign=-ga.sign;queue.push(b);}
          else if(gb.sign===ga.sign) {
            component.conflicted=true;
            if(a<b)state.gearConflicts.push({a,b,component:component.id,reason:'odd contact cycle'});
          }
        }
      }
      const referenceRadius=gears[start].drive.radius;
      // Equal and opposite pitch-line velocity at every inferred contact. Each
      // disconnected cluster has its own drive; impossible odd cycles remain still.
      const tangentialSpeed=referenceRadius*.38;
      for(const index of component.gears) {
        const drive=gears[index].drive;
        drive.angularSpeed=component.conflicted?0:drive.sign*tangentialSpeed/drive.radius;
        component.contactCount+=adjacent[index].length;
      }
      component.contactCount/=2;
      state.gearComponents.push(component);
    }
    const width = Math.max(bounds.max.x - bounds.min.x, .01);
    const height = Math.max(bounds.max.y - bounds.min.y, .01);
    const positions = new Float32Array(count * 3), sizes = new Float32Array(count);
    const phases = new Float32Array(count), outlets = [];
    for (const part of parts) {
      if (part.role !== 'valve_wheel') continue;
      const point = new THREE.Vector3();
      part.object.getWorldPosition(point).applyMatrix4(inverse);
      point.z = bounds.max.z + height * .012;
      outlets.push(point);
    }
    if (!outlets.length) outlets.push(new THREE.Vector3(
      (bounds.min.x + bounds.max.x) / 2, bounds.min.y + height * .45, bounds.max.z + height * .02));
    for (let i = 0; i < count; i++) phases[i] = ((i * .61803398875) % 1);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('particleSize', new THREE.BufferAttribute(sizes, 1).setUsage(THREE.DynamicDrawUsage));
    geometry.setDrawRange(0, 0);
    const material = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.NormalBlending,
      uniforms: {opacity: {value: .17}},
      vertexShader: 'attribute float particleSize; varying float vSize; void main(){ vec4 p=modelViewMatrix*vec4(position,1.); gl_Position=projectionMatrix*p; gl_PointSize=clamp(particleSize*600./max(.05,-p.z),1.,52.); vSize=particleSize; }',
      fragmentShader: 'uniform float opacity; varying float vSize; void main(){ float r=length(gl_PointCoord-vec2(.5))*2.; if(r>=1. || vSize<=0.) discard; float a=(1.-smoothstep(.1,1.,r))*opacity; gl_FragColor=vec4(.84,.88,.9,a); }'
    });
    const steam = new THREE.Points(geometry, material);
    steam.name = 'WallAnimation_PooledSteam';
    steam.userData.wallAnimationEffect = true;
    steam.frustumCulled = false;
    steam.visible = false;
    model.add(steam);
    let clock = 0,drivePhase=0;
    function reset() {
      if (state.disposed) return;
      for (const part of parts) {part.object.quaternion.copy(part.base);part.turnRemaining=0;}
      state.elapsed = 0;
      state.startup=0;state.releaseRemaining=0;state.valveTurns=0;
      drivePhase=0;
      state.overdrive = false;
      state.overdriveUntil = 0;
      state.activeParticles = 0;
      positions.fill(0); sizes.fill(0);
      geometry.attributes.position.needsUpdate = true;
      geometry.attributes.particleSize.needsUpdate = true;
      geometry.setDrawRange(0, 0);
      steam.visible = false;
    }
    function update(deltaMs, nowMs) {
      if (state.disposed) return;
      const dt = Number.isFinite(deltaMs) ? Math.max(0, Math.min(100, deltaMs)) / 1000 : 0;
      clock = Number.isFinite(nowMs) ? nowMs : clock + dt * 1000;
      if (state.overdrive && clock >= state.overdriveUntil) {
        state.overdrive = false; state.overdriveUntil = 0;
      }
      if (!state.running || !state.tracked || state.reducedMotion) return;
      const boost = state.overdrive ? 3 : 1;
      state.elapsed += dt * boost;
      state.startup=Math.min(1,state.startup+dt/2.4);
      state.releaseRemaining=Math.max(0,state.releaseRemaining-dt);
      const startup=state.startup*state.startup*(3-2*state.startup);
      // A shared drive pulse makes the engine feel loaded while every meshing
      // pair retains equal pitch-line speed and its authored starting phase.
      drivePhase+=dt*boost*(.12+.88*startup)*(state.releaseRemaining>0?.65:1)*(1+.13*Math.sin(state.elapsed*2.1)+.055*Math.sin(state.elapsed*4.2));
      for (const part of parts) {
        part.turnRemaining=Math.max(0,part.turnRemaining-dt);
        const manualTurn=part.turnRemaining>0?Math.sin((1-part.turnRemaining/2.4)*Math.PI)*Math.PI*.6:0;
        const angle = part.role === 'gear'
          ? drivePhase * part.drive.angularSpeed
          : part.role === 'control_handle' ? manualTurn*.45 : startup*(Math.sin(state.elapsed*.85+part.index*1.4)+.16*Math.sin(state.elapsed*1.7+part.index*.8))*(30*Math.PI/180)+manualTurn;
        rotation.setFromAxisAngle(axis, angle);
        part.object.quaternion.copy(part.base).multiply(rotation);
      }
      if(!state.steamEnabled) return;
      for (let i = 0; i < count; i++) {
        const life = (state.elapsed * .24 + phases[i]) % 1;
        const outlet = outlets[i % outlets.length], offset = i * 3;
        positions[offset] = outlet.x + Math.sin(life * 6 + i * 2.4) * width * .012 * life;
        positions[offset + 1] = outlet.y + life * height * .25;
        positions[offset + 2] = outlet.z + life * height * .035;
        sizes[i] = height * (.012 + life * .025) * Math.sin(life * Math.PI);
      }
      material.uniforms.opacity.value = state.overdrive ? .29 : .17;
      geometry.attributes.position.needsUpdate = true;
      geometry.attributes.particleSize.needsUpdate = true;
      geometry.setDrawRange(0, count);
      steam.visible = true;
      state.activeParticles = count;
    }
    return {
      state, steam,
      setSteamEnabled(value) {
        if(state.disposed)return;
        state.steamEnabled=!!value;
        if(!value){state.activeParticles=0;geometry.setDrawRange(0,0);steam.visible=false;}
      },
      pause() {
        if (state.disposed) return;
        state.running = false;
        state.releaseRemaining=0;for(const part of parts)part.turnRemaining=0;
        state.overdrive = false;
        state.overdriveUntil = 0;
        state.activeParticles = 0;
        geometry.setDrawRange(0, 0);
        steam.visible = false;
      },
      setRunning(value) { if (state.disposed) return; state.running = !!value; if (!value) reset(); },
      setTracked(value) { if (state.disposed) return; state.tracked = !!value; if (!value) reset(); },
      setReducedMotion(value) { if (state.disposed) return; state.reducedMotion = !!value; if (value) reset(); },
      triggerOverdrive(nowMs) {
        if (state.disposed || !state.running || !state.tracked || state.reducedMotion) return false;
        state.overdrive = true;
        state.overdriveUntil = (Number.isFinite(nowMs) ? nowMs : clock) + 3000;
        return true;
      },
      triggerRelease() {
        if(state.disposed || !state.running || !state.tracked || state.reducedMotion)return false;
        state.releaseRemaining=1.8;return true;
      },
      turnHandle(name) {
        if(state.disposed || !state.running || !state.tracked || state.reducedMotion)return false;
        const handle=parts.find(part=>part.role==='control_handle' && (!name || part.object.name===name));
        if(!handle)return false;handle.turnRemaining=2.4;state.releaseRemaining=1.8;return true;
      },
      getInteractionTargets() {
        return parts.filter(part=>part.role==='control_handle').map(part=>{
          const box=new THREE.Box3().setFromObject(part.object),sphere=box.getBoundingSphere(new THREE.Sphere()),scale=new THREE.Vector3();
          part.object.getWorldScale(scale);
          return {object:part.object,name:part.object.name,role:'control_handle',action:'handle',center:part.object.worldToLocal(sphere.center.clone()),radius:sphere.radius/Math.max(scale.x,scale.y,scale.z,1e-6)};
        });
      },
      turnValve(name) {
        if(state.disposed || !state.running || !state.tracked || state.reducedMotion)return false;
        const valve=parts.find(part=>part.role==='valve_wheel' && (!name || part.object.name===name));
        if(!valve)return false;
        valve.turnRemaining=2.4;state.valveTurns++;state.releaseRemaining=1.8;return true;
      },
      reset, update,
      dispose() {
        if (state.disposed) return;
        reset(); state.running = false; state.disposed = true;
        steam.removeFromParent(); geometry.dispose(); material.dispose();
      }
    };
  };
})(typeof window !== 'undefined' ? window : globalThis);
