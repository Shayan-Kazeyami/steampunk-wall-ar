/* Source-mounted effects. No timers, renderer, audio, global materials or DOM ownership. */
export const createMachineEffects = (function (root) {
  'use strict';
  return function createMachineEffects(options) {
    const {THREE, model} = options;
    if (!THREE || !model) throw new Error('createMachineEffects requires THREE and model');
    const count = Math.max(8, Math.min(96, Math.floor(options.particleCount || 96)));
    const gauges = [], lamps = [], outlets = [], valves = [], overlays = [];
    const axis = new THREE.Vector3(0, 0, 1), turn = new THREE.Quaternion();
    const state = {disposed:false, activeParticles:0, pressure:0.48, simulatedSeconds:0, releasing:false};
    let steamEnabled=true, interactive=false;
    let haloTexture=null;
    function getHaloTexture(){
      if(haloTexture)return haloTexture;
      const edge=32,pixels=new Uint8Array(edge*edge*4);
      for(let y=0;y<edge;y++)for(let x=0;x<edge;x++){
        const r=Math.hypot((x+.5)/edge*2-1,(y+.5)/edge*2-1),i=(y*edge+x)*4;
        pixels[i]=255;pixels[i+1]=255;pixels[i+2]=255;pixels[i+3]=Math.round(255*Math.pow(Math.max(0,1-r),2));
      }
      haloTexture=new THREE.DataTexture(pixels,edge,edge,THREE.RGBAFormat);
      haloTexture.minFilter=THREE.LinearFilter;haloTexture.magFilter=THREE.LinearFilter;haloTexture.needsUpdate=true;return haloTexture;
    }
    // Source joints have different release characters. All reuse one small particle pool.
    const profiles=[
      {name:'fine hiss',period:3.7,duration:2.3,rate:17,speed:.060,life:1.25,size:.044,opacity:.22},
      {name:'rolling plume',period:5.3,duration:2.5,rate:20,speed:.045,life:2.25,size:.094,opacity:.26},
      {name:'double pulse',period:2.9,duration:1.0,rate:28,speed:.095,life:1.35,size:.060,opacity:.29},
      {name:'pressure release',period:6.7,duration:1.8,rate:24,speed:.080,life:1.8,size:.080,opacity:.27}
    ];
    let emittingOutlets=0;
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
      const index=outlets.length;
      outlets.push({position, direction,index,profile:profiles[index%profiles.length],phase:index * 1.73,credit:0,explicit:!fallback});
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
        if(!object.geometry.boundingBox)object.geometry.computeBoundingBox();
        const localBox=object.geometry.boundingBox,center=localBox.getCenter(new THREE.Vector3());
        const size=localBox.getSize(new THREE.Vector3()),radius=Math.max(size.x,size.y,size.z)*.5;
        const haloMaterial=new THREE.SpriteMaterial({map:getHaloTexture(),color:data.lamp_color || 0xffb45c,
          transparent:true,opacity:0,blending:THREE.AdditiveBlending,depthWrite:false,depthTest:true,toneMapped:false});
        const halo=new THREE.Sprite(haloMaterial);halo.name='MachineEffects_LampHalo';halo.userData.wallAnimationEffect=true;
        halo.position.copy(center);halo.position.z=localBox.max.z+radius*.08;
        halo.scale.setScalar(Math.max(.005,radius*4));halo.visible=false;object.add(halo);
        lamps.push({object,original,clones,index:lamps.length,halo,haloMaterial,center,radius,on:true,brightness:1});
      }
      if (role === 'steam_outlet') mountOutlet(object, false);
      if (role === 'valve_wheel') valves.push(object);
    });
    // No arbitrary floating outlets on models without source metadata.
    if (!outlets.length) for (const valve of valves) mountOutlet(valve, true);
    for(const gauge of gauges)applyGauge(gauge);

    const positions = new Float32Array(count*3), sizes = new Float32Array(count), alphas = new Float32Array(count);
    const ages = new Float32Array(count), lives = new Float32Array(count), velocities = new Float32Array(count*3);
    const seeds=new Float32Array(count), scales=new Float32Array(count), opacities=new Float32Array(count), lifeProgress=new Float32Array(count);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.BufferAttribute(positions,3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('puffSize',new THREE.BufferAttribute(sizes,1).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('puffAlpha',new THREE.BufferAttribute(alphas,1).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('puffSeed',new THREE.BufferAttribute(seeds,1).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('puffAge',new THREE.BufferAttribute(lifeProgress,1).setUsage(THREE.DynamicDrawUsage));
    geometry.setDrawRange(0,0);
    const material = new THREE.ShaderMaterial({transparent:true,depthWrite:false,depthTest:true,
      uniforms:{pixelScale:{value:Math.max(1,Number(options.pixelScale)||700)},steamColor:{value:new THREE.Color(.88,.91,.93)}},
      vertexShader:'attribute float puffSize; attribute float puffAlpha; attribute float puffSeed; attribute float puffAge; uniform float pixelScale; varying float vAlpha; varying float vSeed; varying float vAge; void main(){vec4 p=modelViewMatrix*vec4(position,1.);gl_Position=projectionMatrix*p;gl_PointSize=clamp(puffSize*pixelScale/max(.05,-p.z),1.,96.);vAlpha=puffAlpha;vSeed=puffSeed*6.2831853;vAge=puffAge;}',
      // A stable per-puff seed keeps its lobed shape as it drifts, rather than swimming
      // through world-position noise. No texture fetches or additional draw calls.
      fragmentShader:'uniform vec3 steamColor; varying float vAlpha; varying float vSeed; varying float vAge; void main(){vec2 uv=(gl_PointCoord-vec2(.5))*2.;float c=cos(vSeed+vAge*.35),s=sin(vSeed+vAge*.35);uv=mat2(c,-s,s,c)*uv;uv.y*=.72+.22*sin(vSeed*2.);float a=atan(uv.y,uv.x);float r=length(uv)/(.82+.10*sin(a*3.+vSeed+vAge*.6)+.06*sin(a*5.-vSeed));if(r>=1.||vAlpha<.001)discard;float edge=1.-smoothstep(.0,1.,r);float cloud=.72+.18*sin(uv.x*8.+vSeed)*sin(uv.y*10.-vSeed)+.10*cos(uv.x*15.+uv.y*12.+vSeed);float rim=.86+.14*smoothstep(.1,.8,uv.y);gl_FragColor=vec4(steamColor*rim,pow(edge,1.5)*cloud*vAlpha);}'
    });
    const steam = new THREE.Points(geometry,material); steam.name = 'MachineEffects_Leaks';
    steam.userData.wallAnimationEffect = true; steam.frustumCulled = false; steam.visible = false; model.add(steam);
    let cursor=0, serial=0, pressureVelocity=0, wasBoost=false,wasRelease=false;
    const fract = value => value-Math.floor(value);
    function clearSteam() {
      lives.fill(0); sizes.fill(0); alphas.fill(0);lifeProgress.fill(0); state.activeParticles=0;
      emittingOutlets=0;
      geometry.setDrawRange(0,0); steam.visible=false;
      for (const outlet of outlets) outlet.credit=0;
    }
    function reset() {
      if (state.disposed) return;
      interactive=false;clearSteam(); state.pressure=.48; state.simulatedSeconds=0;state.releasing=false; pressureVelocity=0; wasBoost=false;wasRelease=false;cursor=0;serial=0;
      for (const gauge of gauges) {
        gauge.override=null;gauge.value=gauge.target=gauge.calibrated?gauge.values[gauge.values.length-1]:0;applyGauge(gauge);
      }
      for (const lamp of lamps) {
        lamp.on=true;lamp.brightness=1;lamp.halo.visible=false;lamp.haloMaterial.opacity=0;
        for (const clone of lamp.clones) clone.emissiveIntensity=Number.isFinite(lamp.object.userData.lamp_intensity) ? lamp.object.userData.lamp_intensity : 1.1;
      }
    }
    function emit(outlet, boost, strength) {
      // A deterministic pool makes regression checks repeatable, with no per-frame allocation.
      const slot=cursor, offset=slot*3; cursor=(cursor+1)%count; serial++;
      const variation=fract(serial*.61803398875), spread=(variation-.5)*height*.03;
      const detail=fract(serial*.41421356237),profile=outlet.profile;
      positions[offset]=outlet.position.x; positions[offset+1]=outlet.position.y; positions[offset+2]=outlet.position.z;
      const speed=height*profile.speed*(.68+detail*.7)*(boost?1.65:1)*strength;
      velocities[offset]=outlet.direction.x*speed+spread;
      velocities[offset+1]=outlet.direction.y*speed;
      velocities[offset+2]=outlet.direction.z*speed+(detail-.5)*height*.012;
      ages[slot]=0;lives[slot]=profile.life*(.7+variation*.65);
      seeds[slot]=detail;scales[slot]=height*profile.size*(.7+detail*.65);
      opacities[slot]=profile.opacity*(.7+variation*.4)*(boost?1.25:1);
      sizes[slot]=height*.006;alphas[slot]=0;lifeProgress[slot]=0;
    }
    function update(deltaMs, nowMs, animationState) {
      if (state.disposed) return;
      const input=animationState || {}, dt=Number.isFinite(deltaMs) ? Math.min(.1,Math.max(0,deltaMs/1000)) : 0;
      interactive=!!input.running && input.tracked!==false && !input.hidden && !input.reducedMotion;
      if (input.reducedMotion || input.tracked === false || input.hidden) { reset(); return; }
      if (!input.running) { if (!input.elapsed) reset(); else clearSteam(); return; }
      const starting=state.simulatedSeconds===0 && Number.isFinite(input.startup);
      state.simulatedSeconds+=dt;
      const t=state.simulatedSeconds, boost=!!input.overdrive,releasing=input.releaseRemaining>0;
      const startup=Number.isFinite(input.startup)?Math.max(0,Math.min(1,input.startup)):1;
      state.releasing=releasing;
      const target=releasing ? .22 : (boost ? .82 : .48)*(.4+.6*startup);
      // Critically damped regulator response; release follows the same pressure as gauges.
      pressureVelocity+=(20*(target-state.pressure)-9*pressureVelocity)*dt;
      state.pressure=Math.max(.12,Math.min(.94,state.pressure+pressureVelocity*dt));
      for (const gauge of gauges) {
        if(!gauge.calibrated)continue;
        if(starting && gauge.override===null)gauge.value=gauge.values[0];
        gauge.target=Math.max(gauge.values[0],Math.min(gauge.values[gauge.values.length-1],gauge.override===null?(boost?gauge.boost:gauge.idle + (Math.sin(t*.83+gauge.index*1.7)*1.65+Math.sin(t*.31+gauge.index*.9)*.65))*(releasing ? .35 : .35+.65*startup):gauge.override));
        gauge.value+=(gauge.target-gauge.value)*(1-Math.exp(-dt/gauge.response));
        applyGauge(gauge);
      }
      for (const lamp of lamps) {
        // Independently phased, irregular soft dips: no rapid flashes or shared strobe.
        const phase=t*(.59+lamp.index*.073)+lamp.index*2.399;
        const wave=.5+.5*Math.sin(phase+.65*Math.sin(phase*.43+lamp.index));
        const dip=Math.pow(wave,10);
        const desired=lamp.on ? (.95-.67*dip)*(boost?1.45:1) : 0;
        lamp.brightness+=(desired-lamp.brightness)*(1-Math.exp(-dt/.22));
        const base=Number.isFinite(lamp.object.userData.lamp_intensity) ? lamp.object.userData.lamp_intensity : 1.1;
        for (const clone of lamp.clones) clone.emissiveIntensity=base*lamp.brightness;
        lamp.halo.visible=lamp.on || lamp.brightness>.01;
        lamp.haloMaterial.opacity=Math.min(.42,.28*lamp.brightness);
      }
      emittingOutlets=0;
      const previousSerial=serial;
      if(steamEnabled) for (const outlet of outlets) {
        const profile=outlet.profile,cycle=Math.floor((t+outlet.phase)/profile.period);
        const within=(t+outlet.phase)%profile.period;
        const strength=.85+.25*Math.sin(cycle*2.399+outlet.index*1.9);
        const progress=within/profile.duration;
        // Two sharp chuffs, a long rolling release, or a soft steady hiss; each
        // cycle changes strength without introducing timers or random allocations.
        const envelope=outlet.index%4===2
          ? Math.pow(Math.sin(progress*Math.PI*2),2)
          : .35+.65*Math.sin(Math.min(1,progress)*Math.PI);
        const outletReleasing=boost || releasing || within<profile.duration;
        if (boost && !wasBoost) for(let i=0;i<5;i++) emit(outlet,true,strength);
        if(releasing && !wasRelease)for(let i=0;i<7;i++)emit(outlet,true,1.35);
        if (outletReleasing) {
          emittingOutlets++;
          outlet.credit+=dt*profile.rate*strength*(.55+.45*startup)*(releasing?2.1:(boost?1.5+.5*Math.sin(t*7+outlet.phase):envelope));
          while(outlet.credit>=1) { emit(outlet,boost,strength); outlet.credit--; }
        } else outlet.credit=0;
      }
      wasBoost=boost;wasRelease=releasing; let active=0;
      for(let i=0;i<count;i++) {
        if(lives[i]<=0) continue;
        ages[i]+=dt; const life=ages[i]/lives[i];
        lifeProgress[i]=Math.min(1,life);
        if(life>=1) {lives[i]=0;alphas[i]=0;sizes[i]=0;continue;}
        active++; const offset=i*3;
        const seed=seeds[i]*Math.PI*2,drag=Math.exp(-dt*.65);
        // Buoyant curls and a slow common breeze break up straight, repeated trails.
        velocities[offset]=velocities[offset]*drag+height*dt*(.018*Math.sin(ages[i]*3.1+seed)+.010*Math.sin(t*.7));
        velocities[offset+2]=velocities[offset+2]*drag+height*dt*.012*Math.cos(ages[i]*2.3+seed);
        positions[offset]+=velocities[offset]*dt;
        velocities[offset+1]+=height*.018*dt;
        positions[offset+1]+=velocities[offset+1]*dt;
        positions[offset+2]+=velocities[offset+2]*dt;
        sizes[i]=height*.006+scales[i]*Math.pow(life,.75);
        alphas[i]=opacities[i]*Math.sin(Math.PI*life)*Math.min(1,life*10);
      }
      state.activeParticles=active;
      geometry.attributes.position.needsUpdate=true;geometry.attributes.puffSize.needsUpdate=true;geometry.attributes.puffAlpha.needsUpdate=true;geometry.attributes.puffAge.needsUpdate=true;
      if(serial!==previousSerial)geometry.attributes.puffSeed.needsUpdate=true;
      geometry.setDrawRange(0,active ? count : 0); steam.visible=active>0;
    }
    return {steam,state,update,reset,
      interact(action,name) {
        if(state.disposed || !interactive || action!=='lamp')return false;
        const lamp=lamps.find(lamp=>!name || lamp.object.name===name);if(!lamp)return false;
        lamp.on=!lamp.on;return true;
      },
      getInteractionTargets() {return lamps.map(lamp=>({object:lamp.object,name:lamp.object.name,role:'lamp',action:'lamp',center:lamp.center.clone(),radius:Math.max(.004,lamp.radius)}));},
      setLighting(gain,color) {
        if(state.disposed || !Number.isFinite(gain) || !Array.isArray(color) || color.length!==3 || !color.every(Number.isFinite))return;
        const brightness=Math.max(.58,Math.min(1.12,Math.sqrt(Math.max(.1,gain))));
        material.uniforms.steamColor.value.setRGB(.88*color[0]*brightness,.91*color[1]*brightness,.93*color[2]*brightness);
      },
      setSteamEnabled(value) {if(state.disposed)return;steamEnabled=!!value;if(!steamEnabled)clearSteam();},
      setGaugeValue(name,value) {
        const gauge=gauges.find(g=>g.object.name===name);
        if(state.disposed || !gauge?.calibrated || !Number.isFinite(value))return false;
        gauge.override=Math.max(gauge.values[0],Math.min(gauge.values[gauge.values.length-1],value));return true;
      },
      getDiagnostics() {return {gaugeCount:gauges.length,lampCount:lamps.length,outletCount:outlets.length,
        fallbackOutlets:outlets.some(o=>!o.explicit),
        lampGlowMode:'localized-additive-halo',lamps:lamps.map(l=>({name:l.object.name,on:l.on,brightness:l.brightness,haloVisible:l.halo.visible})),idleGaugeMotion:'bounded-calibrated-pressure',steamProfiles:outlets.map(o=>o.profile.name),emittingOutlets,emittedParticles:serial,
        gauges:gauges.map(g=>({name:g.object.name,calibrated:g.calibrated,value:g.value,target:g.target,angleDegrees:g.angle,scale:g.calibrated?[g.values[0],g.values[g.values.length-1]]:null})),
        steamDensityPreset:'enhanced',particleCapacity:count,activeParticles:state.activeParticles,pressure:state.pressure,releasing:state.releasing,steamColor:material.uniforms.steamColor.value.toArray(),disposed:state.disposed};},
      dispose() {
        if(state.disposed)return;reset();state.disposed=true;
        steam.removeFromParent();geometry.dispose();material.dispose();
        if(haloTexture)haloTexture.dispose();
        for(const lamp of lamps){lamp.halo.removeFromParent();lamp.haloMaterial.dispose();lamp.object.material=lamp.original;for(const clone of lamp.clones)clone.dispose();}
        for(const pivot of overlays){pivot.traverse(child=>{if(child.isMesh){child.geometry.dispose();child.material.dispose();}});pivot.removeFromParent();}
      }
    };
  };
})(typeof window!=='undefined' ? window : globalThis);
