/* Attached sign illumination and opt-in synthesized machine sound. No render loop. */
export const createExperiencePolish = (function (root) {
  'use strict';
  return function createExperiencePolish(options) {
    const {THREE, model} = options;
    if (!THREE || !model) throw new Error('createExperiencePolish requires THREE and model');
    const state = {disposed:false, soundEnabled:false, audioStatus:'off', audioError:null,
      signCount:0, decorativeMeshes:0, elapsed:0,signActivations:0};
    const anchors = [], decorations = [], resources = [];
    model.traverse(object => {
      if (object.userData && object.userData.animation_role === 'signboard') anchors.push(object);
    });
    const finitePositive = value => Number.isFinite(value) && value > 0;
    for (const anchor of anchors) {
      const data = anchor.userData;
      let box;
      if (anchor.geometry) {
        if (!anchor.geometry.boundingBox) anchor.geometry.computeBoundingBox();
        box = anchor.geometry.boundingBox;
      }
      const width = finitePositive(data.sign_width) ? data.sign_width : box && box.max.x-box.min.x;
      const height = finitePositive(data.sign_height) ? data.sign_height : box && box.max.y-box.min.y;
      if (!finitePositive(width) || !finitePositive(height)) continue;
      const cx = box ? (box.min.x+box.max.x)/2 : 0;
      const cy = box ? (box.min.y+box.max.y)/2 : 0;
      const z = Number.isFinite(data.sign_front_z) ? data.sign_front_z : (box ? box.max.z : 0);
      const radius = Math.min(width*.009, height*.025);
      const group = new THREE.Group();
      group.name = 'ExperiencePolish_SignEdge';
      group.userData.experiencePolishEffect = true;
      group.position.set(cx,cy,z+radius*.8);
      const lampGeometry = new THREE.SphereGeometry(radius, 8, 6);
      const lampMaterial = new THREE.MeshBasicMaterial({color:0xc38c3e, toneMapped:false});
      const glintGeometry = new THREE.BoxGeometry(width*.13, radius*.65, radius*.5);
      const glintMaterial = new THREE.MeshBasicMaterial({color:0xffd49b, transparent:true,
        opacity:.32, depthWrite:false, toneMapped:false});
      resources.push(lampGeometry,lampMaterial,glintGeometry,glintMaterial);
      // Small fittings follow the existing frame. No atlas or board transform edits.
      for (const x of [-.46,0,.46]) {
        for (const y of [-.46,.46]) {
          const lamp = new THREE.Mesh(lampGeometry,lampMaterial);
          lamp.position.set(x*width,y*height,0);
          group.add(lamp);
        }
      }
      const glint = new THREE.Mesh(glintGeometry,glintMaterial);
      glint.position.set(0,height*.46,radius);
      group.add(glint);
      anchor.add(group);
      decorations.push({anchor,group,glint,lampMaterial,glintMaterial,width,height,radius,activation:0,center:new THREE.Vector3(cx,cy,z)});
      state.signCount++;
      state.decorativeMeshes += group.children.length;
    }
    let audio = null, generation = 0, lastTick = -1, machine = {};
    const document = options.document || root.document;
    const Context = options.AudioContext || root.AudioContext || root.webkitAudioContext;
    function releaseSound() {
      ++generation;
      state.soundEnabled = false;
      if (audio) {
        for (const source of audio.sources) { try { source.stop(); } catch (_) {} }
        try { audio.context.close().catch(() => {}); } catch (_) {}
        audio = null;
      }
      if (state.audioStatus !== 'unavailable' && state.audioStatus !== 'error') state.audioStatus = 'off';
    }
    function target(param,value,time,smoothing) {
      param.setTargetAtTime(value,time,smoothing || .045);
    }
    // Call only from an explicit sound button click. update() never creates/resumes audio.
    async function setSoundEnabled(enabled) {
      if (state.disposed) return false;
      if (!enabled) { releaseSound(); return false; }
      if (!Context) { state.audioStatus='unavailable'; return false; }
      if (document && document.hidden) return false;
      if (audio && state.soundEnabled) return true;
      releaseSound();
      const token = generation;
      let context;
      try {
        context = new Context();
        const master = context.createGain();
        master.gain.value = 0;
        master.connect(context.destination);
        const hum = context.createOscillator(), rumble = context.createOscillator();
        const humGain = context.createGain();
        hum.type='sine'; hum.frequency.value=72;
        rumble.type='triangle'; rumble.frequency.value=36;
        humGain.gain.value=.25;
        hum.connect(humGain); rumble.connect(humGain); humGain.connect(master);
        const noiseBuffer = context.createBuffer(1,context.sampleRate,context.sampleRate);
        const samples = noiseBuffer.getChannelData(0);
        let seed=173;
        for (let i=0;i<samples.length;i++) {
          seed=(Math.imul(seed,1664525)+1013904223)|0;
          samples[i]=seed/2147483648;
        }
        const hiss=context.createBufferSource(), filter=context.createBiquadFilter();
        const hissGain=context.createGain();
        hiss.buffer=noiseBuffer; hiss.loop=true;
        filter.type='bandpass'; filter.frequency.value=1600; filter.Q.value=.55;
        hissGain.gain.value=0;
        hiss.connect(filter); filter.connect(hissGain); hissGain.connect(master);
        const tick=context.createOscillator(), tickGain=context.createGain();
        tick.type='triangle'; tick.frequency.value=340; tickGain.gain.value=0;
        tick.connect(tickGain); tickGain.connect(master);
        const sources=[hum,rumble,hiss,tick];
        audio={context,master,hum,rumble,hissGain,tickGain,sources};
        sources.forEach(source => source.start());
        state.audioStatus='starting';
        await context.resume();
        if (state.disposed || token!==generation || audio.context!==context) {
          try { await context.close(); } catch (_) {}
          return false;
        }
        state.soundEnabled=true;
        state.audioStatus='on';
        state.audioError=null;
        return true;
      } catch (error) {
        if (token===generation) {
          releaseSound();
          state.audioStatus='error';
          state.audioError=String(error && error.message || error);
        }
        if (context) { try { await context.close(); } catch (_) {} }
        return false;
      }
    }
    function rest() {
      for (const sign of decorations) {
        sign.lampMaterial.color.setRGB(.48,.27,.08);
        sign.glint.visible=false;sign.activation=0;
      }
    }
    function onVisibility() { if (document.hidden) { releaseSound(); rest(); } }
    if (document && document.addEventListener) document.addEventListener('visibilitychange',onVisibility);
    rest();
    return {
      state,
      get soundEnabled() { return state.soundEnabled; },
      setSoundEnabled,
      interact(action,name) {
        if(state.disposed || action!=='sign' || !machine.running || machine.tracked===false || machine.reducedMotion || machine.hidden || document?.hidden)return false;
        const sign=decorations.find(sign=>!name || sign.anchor.name===name);if(!sign)return false;
        sign.activation=2.6;state.signActivations++;return true;
      },
      getInteractionTargets() {return decorations.map(sign=>({object:sign.anchor,name:sign.anchor.name,role:'signboard',action:'sign',center:sign.center.clone(),radius:Math.hypot(sign.width,sign.height)*.5}));},
      update(deltaMs,nowMs,nextState) {
        if (state.disposed) return;
        machine=nextState || machine;
        const hidden=machine.hidden || (document && document.hidden);
        if (hidden || machine.tracked===false || machine.stopped) {
          releaseSound(); rest(); return;
        }
        const running=!!machine.running, reduced=!!machine.reducedMotion;
        const boost=machine.overdrive ? 1 : 0;
        const releasing=machine.releaseRemaining>0;
        const startup=Number.isFinite(machine.startup)?machine.startup:1;
        const dt=Number.isFinite(deltaMs) ? Math.max(0,Math.min(deltaMs,100))/1000 : 0;
        if (running && !reduced) state.elapsed+=dt*(boost ? 1.6 : 1);
        const phase=state.elapsed;
        for (const sign of decorations) {
          sign.activation=Math.max(0,sign.activation-dt);
          const activated=sign.activation>0 && running && !reduced;
          const sweep=activated ? (1-sign.activation/2.6)*2-1 : Math.sin(phase*.42);
          const pulse=activated ? 1.15 : running && !reduced ? .88+.12*Math.sin(phase*1.25) : .82;
          sign.lampMaterial.color.setRGB(.62*pulse,.34*pulse,.10*pulse);
          sign.glint.visible=running && !reduced;
          // A reflected edge highlight moves inside the frame, never across lettering.
          sign.glint.position.x=sweep*sign.width*.36;
          sign.glintMaterial.opacity=(activated?.65:.18+boost*.16)*Math.pow(.5+.5*Math.cos(activated?sweep*Math.PI*.6:phase*.42),2);
        }
        if (audio && state.soundEnabled) {
          const time=audio.context.currentTime;
          target(audio.master.gain,running ? .065*(.25+.75*startup) : 0,time,.08);
          target(audio.hum.frequency,(boost ? 93 : 72)*(.65+.35*startup),time,.18);
          target(audio.rumble.frequency,(boost ? 46.5 : 36)*(.65+.35*startup),time,.18);
          const leak=Math.pow(Math.max(0,Math.sin(phase*.73)),12);
          target(audio.hissGain.gain,running ? (releasing ? .65 : .08+leak*(boost ? .7 : .35)) : 0,time,.07);
          const tickIndex=Math.floor(phase*2.4);
          if (running && tickIndex!==lastTick) {
            lastTick=tickIndex;
            audio.tickGain.gain.cancelScheduledValues(time);
            audio.tickGain.gain.setValueAtTime(.2,time);
            audio.tickGain.gain.exponentialRampToValueAtTime(.0001,time+.055);
          }
          if (!running) target(audio.tickGain.gain,0,time,.015);
        }
      },
      reset() {
        if (state.disposed) return;
        releaseSound(); state.elapsed=0; lastTick=-1; machine={}; rest();
      },
      dispose() {
        if (state.disposed) return;
        releaseSound();
        if (document && document.removeEventListener) document.removeEventListener('visibilitychange',onVisibility);
        for (const sign of decorations) sign.group.removeFromParent();
        for (const resource of resources) resource.dispose();
        state.disposed=true;
      }
    };
  };
})(typeof window!=='undefined' ? window : globalThis);
