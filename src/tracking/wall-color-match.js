// Local, bounded print/camera correspondence. No image storage, network or render loop.
// PixelArray row zero is camera-source TOP. The engine viewport uses bottom-left
// drawing-buffer pixels. The caller must freeze matrices/viewport for the same
// previous-FBO frame as PixelArray; current display pose is not interchangeable.
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value))
const median=values=>{const a=values.slice().sort((x,y)=>x-y),m=Math.floor(a.length/2);return a.length%2?a[m]:(a[m-1]+a[m])/2}
const linear=value=>{const c=value/255;return c<=.04045?c/12.92:Math.pow((c+.055)/1.055,2.4)}
const matrix=value=>value?.elements || value
function transform(m,x,y,z,w=1){
  return [m[0]*x+m[4]*y+m[8]*z+m[12]*w,m[1]*x+m[5]*y+m[9]*z+m[13]*w,
    m[2]*x+m[6]*y+m[10]*z+m[14]*w,m[3]*x+m[7]*y+m[11]*z+m[15]*w]
}
function validMatrix(value){return value?.length===16 && Array.from(value).every(Number.isFinite)}
function cameraCell(frame,corners){
  const points=corners.map(([u,v])=>[u*frame.cols,v*frame.rows])
  if(points.some(([x,y])=>x<0 || y<0 || x>frame.cols || y>frame.rows))return null
  const minX=Math.max(0,Math.floor(Math.min(...points.map(p=>p[0])))),maxX=Math.min(frame.cols,Math.ceil(Math.max(...points.map(p=>p[0]))))
  const minY=Math.max(0,Math.floor(Math.min(...points.map(p=>p[1])))),maxY=Math.min(frame.rows,Math.ceil(Math.max(...points.map(p=>p[1]))))
  const inside=(x,y)=>{
    let sign=0
    for(let i=0;i<4;i++){
      const a=points[i],b=points[(i+1)%4],cross=(b[0]-a[0])*(y-a[1])-(b[1]-a[1])*(x-a[0])
      if(Math.abs(cross)<1e-8)continue
      if(sign && Math.sign(cross)!==sign)return false
      sign=Math.sign(cross)
    }
    return true
  }
  let weight=0,clipped=0
  const sum=[0,0,0]
  for(let y=minY;y<maxY;y++)for(let x=minX;x<maxX;x++){
    let coverage=0
    for(let sy=0;sy<4;sy++)for(let sx=0;sx<4;sx++)if(inside(x+(sx+.5)/4,y+(sy+.5)/4))coverage+=1/16
    if(!coverage)continue
    const i=y*frame.rowBytes+x*4
    if(frame.pixels[i+3]<250)return null
    if(Math.max(frame.pixels[i],frame.pixels[i+1],frame.pixels[i+2])>=252)clipped+=coverage
    for(let c=0;c<3;c++)sum[c]+=frame.pixels[i+c]*coverage
    weight+=coverage
  }
  if(weight<4 || clipped/weight>.1)return null
  return {rgb:sum.map(value=>linear(value/weight)),key:points[0].join(',')}
}
function cameraPixel(frame,u,v){
  const x=u*frame.cols-.5,y=v*frame.rows-.5,x0=Math.floor(x),y0=Math.floor(y),fx=x-x0,fy=y-y0
  if(x0<0 || y0<0 || x0+1>=frame.cols || y0+1>=frame.rows)return null
  const rgb=[0,0,0]
  for(const [dx,dy,weight] of [[0,0,(1-fx)*(1-fy)],[1,0,fx*(1-fy)],[0,1,(1-fx)*fy],[1,1,fx*fy]]){
    const i=(y0+dy)*frame.rowBytes+(x0+dx)*4
    if(frame.pixels[i+3]<250)return null
    for(let c=0;c<3;c++)rgb[c]+=linear(frame.pixels[i+c])*weight
  }
  return {rgb,key:x0+','+y0}
}

export function sampleWallColorMatch({frame,viewport,canvasWidth,canvasHeight,reference,panelMatrix,viewProjectionMatrix,
  candidateId,wallId,targetName,frameAligned=false,poseStable=true,onDiagnostic}={}){
  const diagnostic=(status,reason,details={})=>{try{if(typeof onDiagnostic==='function')onDiagnostic({status,reason,...details})}catch(error){}}
  const reject=(reason,details)=>{diagnostic('rejected',reason,details);return null}
  if(frameAligned!==true || poseStable!==true || reference?.schemaVersion!==1 ||
    candidateId!==reference.candidateId || wallId!==reference.wallId || targetName!==reference.targetName || typeof targetName!=='string')return reject(!frameAligned?'frame-not-aligned':!poseStable?'pose-moving':'reference-identity-mismatch')
  const panel=matrix(panelMatrix),vp=matrix(viewProjectionMatrix)
  if(!validMatrix(panel) || !validMatrix(vp) || !Number.isFinite(reference.panelAspect) || reference.panelAspect<=0)return reject('invalid-projection')
  if(!Number.isFinite(canvasWidth) || !Number.isFinite(canvasHeight) || canvasWidth<=0 || canvasHeight<=0 ||
    !viewport || ![viewport.width,viewport.height,viewport.offsetX,viewport.offsetY].every(Number.isFinite) || viewport.width<=0 || viewport.height<=0)return reject('invalid-viewport')
  if(!Number.isInteger(frame?.rows) || !Number.isInteger(frame?.cols) || frame.rows<4 || frame.cols<4 || frame.rows>96 || frame.cols>96 ||
    !Number.isInteger(frame.rowBytes) || frame.rowBytes<frame.cols*4 || !frame.pixels || frame.pixels.length<frame.rows*frame.rowBytes)return reject('invalid-camera-frame')
  const region=reference.regionUv
  if(!Array.isArray(region) || region.length!==4 || !region.every(Number.isFinite) || region[2]<=region[0] || region[3]<=region[1] ||
    !Array.isArray(reference.patches) || reference.patches.length<12 || reference.patches.length>96)return reject('invalid-reference-patches')
  const samples=[],used=new Set()
  function project(u,v){
    const world=transform(panel,u-.5,(.5-v)*reference.panelAspect,0),clip=transform(vp,...world)
    if(clip[3]<=1e-6)return null
    const nx=clip[0]/clip[3],ny=clip[1]/clip[3],nz=clip[2]/clip[3]
    if(nx<=-1 || nx>=1 || ny<=-1 || ny>=1 || nz< -1 || nz>1)return null
    return [((nx+1)*canvasWidth/2-viewport.offsetX)/viewport.width,1-((ny+1)*canvasHeight/2-viewport.offsetY)/viewport.height]
  }
  for(const patch of reference.patches){
    if(!Number.isFinite(patch.u) || !Number.isFinite(patch.v) || patch.u<region[0] || patch.u>region[2] || patch.v<region[1] || patch.v>region[3] || !Array.isArray(patch.rgb) || patch.rgb.length!==3 ||
      !patch.rgb.every(value=>Number.isFinite(value) && value>=0 && value<=255))continue
    const cell=Number.isFinite(patch.halfU) && Number.isFinite(patch.halfV) && patch.halfU>0 && patch.halfV>0
    let observed
    if(cell){
      const corners=[[-1,-1],[1,-1],[1,1],[-1,1]].map(([x,y])=>project(patch.u+x*patch.halfU,patch.v+y*patch.halfV))
      if(corners.some(value=>!value))continue
      observed=cameraCell(frame,corners)
    }else{
      const point=project(patch.u,patch.v)
      if(!point)continue
      observed=cameraPixel(frame,...point)
    }
    if(!observed || !observed.rgb.every(Number.isFinite) || used.has(observed.key))continue
    const expected=patch.rgb.map(linear),seen=observed.rgb
    const luminance=rgb=>.2126*rgb[0]+.7152*rgb[1]+.0722*rgb[2]
    if(luminance(expected)<(cell ? .004 : .025) || luminance(expected)>.65 || luminance(seen)<(cell ? .003 : .012) || luminance(seen)>.88 ||
      expected.some(c=>c<(cell ? .002 : .012)) || seen.some(c=>c<(cell ? .0015 : .005) || c>.96))continue
    used.add(observed.key)
    samples.push({u:patch.u,v:patch.v,logs:seen.map((value,c)=>Math.log(value/expected[c]))})
  }
  if(samples.length<12)return reject('insufficient-visible-unclipped-patches',{samples:samples.length,required:12})
  const center=[0,1,2].map(c=>median(samples.map(sample=>sample.logs[c])))
  const residual=sample=>Math.max(...sample.logs.map((value,c)=>Math.abs(value-center[c])))
  const inliers=samples.filter(sample=>residual(sample)<.32)
  if(inliers.length<12 || inliers.length/samples.length<.6)return reject('inconsistent-patches',{samples:samples.length,inliers:inliers.length})
  const fitted=[0,1,2].map(c=>median(inliers.map(sample=>sample.logs[c])))
  const raw=fitted.map(Math.exp)
  if(raw.some(value=>value<.3 || value>3))return reject('correction-out-of-range',{samples:samples.length,inliers:inliers.length})
  const fitResidual=median(inliers.map(sample=>Math.max(...sample.logs.map((value,c)=>Math.abs(value-fitted[c])))))
  if(fitResidual>.2)return reject('fit-residual-too-high',{fitResidual})
  // A small occluder or one flat patch must not define the entire correction.
  const spanU=Math.max(...inliers.map(s=>s.u))-Math.min(...inliers.map(s=>s.u))
  const spanV=Math.max(...inliers.map(s=>s.v))-Math.min(...inliers.map(s=>s.v))
  const quadrants=new Set(inliers.map(s=>(s.u>(region[0]+region[2])/2?1:0)+(s.v>(region[1]+region[3])/2?2:0)))
  if(spanU<(region[2]-region[0])*.35 || spanV<(region[3]-region[1])*.35 || quadrants.size<3)return reject('insufficient-spatial-support',{spanU,spanV,quadrants:quadrants.size})
  const multiplier=raw.map(value=>clamp(value,.6,1.5))
  const gain=clamp(.2126*multiplier[0]+.7152*multiplier[1]+.0722*multiplier[2],.35,1.8)
  const confidence=clamp(Math.min(1,inliers.length/24)*(inliers.length/samples.length)*(1-fitResidual/.4),0,1)
  if(confidence<.25)return reject('low-confidence',{confidence})
  diagnostic('accepted','qualified-reference-fit',{confidence,fitResidual,samples:samples.length,inliers:inliers.length})
  return {source:'tracked-wall-reference',candidateId,wallId,targetName,gain,color:multiplier.map(value=>clamp(value/gain,.75,1.25)),
    wallColorMultiplier:multiplier,confidence,fitResidual,samples:samples.length,inliers:inliers.length}
}
