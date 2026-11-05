interface EditorLink {origin_id:string|number;origin_slot:number;}
interface EditorTarget {inputs?:readonly {link?:string|number|null}[];graph?:{links:Map<string|number,EditorLink>|Record<string,EditorLink>};}

/** Reject another route from the same native output without changing saved slots. */
export function canConnectEditorInput(target:EditorTarget,source:{id:string|number}|null|undefined,sourceSlot:number,index:number):boolean {
 if(!source||!target.graph)return false;
 return !(target.inputs||[]).some((input,i)=>{
  if(i===index||input.link==null)return false;
  const links=target.graph!.links,link=links instanceof Map?links.get(input.link):links[String(input.link)];
  return !!link&&String(link.origin_id)===String(source.id)&&link.origin_slot===sourceSlot;
 });
}
