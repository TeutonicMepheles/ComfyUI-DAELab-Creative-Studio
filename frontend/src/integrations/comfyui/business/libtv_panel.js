import {app} from '/scripts/app.js';
import {installVideoTasks} from '../../../features/generation/video_tasks_panel.mjs';
import {removeOwnedWidgets} from './dynamic_widget_lifecycle.mjs';
const TYPE='DAELAB.LibTV.VideoGenerate',nodes=new Set();
let syncTimer;
const widget=(node,name)=>node.widgets?.find(w=>w.name===name);
function install(node){if(!node.graph)return;if(node.__libtvPanel){node.__libtvPanel.sync();return;}node.__libtvPanel=installVideoTasks(node,app);nodes.add(node);}
app.registerExtension({name:'DAELab.LibTV.Panel',setup(){syncTimer??=setInterval(()=>{for(const node of nodes)node.__libtvPanel?.sync();},300);},beforeRegisterNodeDef(type,data){
 if(data.name!==TYPE)return;
 for(const method of ['onNodeCreated','onConfigure','onAdded']){const previous=type.prototype[method];type.prototype[method]=function(){
  const result=previous?.apply(this,arguments);
  if(method==='onConfigure'){
   const task=widget(this,'task_data'),index=this.widgets.filter(w=>w.serialize!==false).indexOf(task);
   if(task)task.value=arguments[0]?.widgets_values?.[index]||'';
   this.__libtvPanel?.dispose();removeOwnedWidgets(this,'__daelabLibTVPanel');this.__libtvPanel?.root.remove();delete this.__libtvPanel;
  }
  if(this.graph)install(this);else queueMicrotask(()=>install(this));return result;
 };}
 const removed=type.prototype.onRemoved;type.prototype.onRemoved=function(){nodes.delete(this);removeOwnedWidgets(this,'__daelabLibTVPanel');this.__libtvPanel?.dispose();this.__libtvPanel?.root.remove();delete this.__libtvPanel;return removed?.apply(this,arguments);};
 const executed=type.prototype.onExecuted;type.prototype.onExecuted=function(message){const result=executed?.apply(this,arguments);this.__libtvPanel?.acceptResult(message);return result;};
}});
