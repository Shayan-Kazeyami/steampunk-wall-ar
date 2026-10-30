import spec from '../shared/spec.json'
import drivewayManifest from '../../config/targets/driveway.json'
import drivewayTarget from '../../image-targets/steampunk-driveway-sign.json'

function entry(id,label,panelKey,manifest,compiledTarget,previewImage){
  const panel=spec.panels[panelKey]
  return {id,label,panel,manifest,compiledTarget,previewImage,effectsConfig:{...spec.effects,panel}}
}
export const experiences=[
  entry('driveway','Driveway','driveway',drivewayManifest,drivewayTarget,'assets/driveway.jpg'),
]
experiences[0].fullWall={modelUrl:'assets/full-wall/driveway-adaptive.glb',environmentUrl:'assets/full-wall/studio_small_09_1k.hdr'}
export function getExperience(search){
  const id=new URLSearchParams(search).get('wall')
  return experiences.find(item=>item.id===id) || experiences[0]
}
