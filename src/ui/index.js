import spec from '../shared/spec.json'
import './ui.css'
import {createUIController} from './controller.js'

export function createUI(options) {
  return createUIController({...options, spec})
}

export default createUI
