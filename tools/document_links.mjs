import path from 'node:path';
const linkPattern=/\]\((<[^>]+>|[^\s)]+)([^)]*)\)/g;
const local=target=>!target.startsWith('#')&&!target.startsWith('/')&&!/^[a-z][a-z0-9+.-]*:/i.test(target);
export function localMarkdownLinks(text){
 const links=[];const prose=text.replace(/^```[^\n]*\n[\s\S]*?^```\s*$/gm,'');
 for(const match of prose.matchAll(linkPattern)){const target=match[1].replace(/^<|>$/g,'');if(local(target))links.push(target);}
 return links;
}
/** Copied docs keep links to the same owning sources, despite a shallower web tree. */
export function relocateMarkdownLinks(text,sourceFile,outputFile){
 return text.replace(linkPattern,(all,raw,title)=>{
  const target=raw.replace(/^<|>$/g,'');if(!local(target))return all;
  const split=target.search(/[?#]/),file=split<0?target:target.slice(0,split),suffix=split<0?'':target.slice(split);
  const resolved=path.resolve(path.dirname(sourceFile),decodeURI(file));
  const relative=path.relative(path.dirname(outputFile),resolved).replaceAll('\\','/');
  const relocated=encodeURI(relative)+suffix;
  return `](${raw.startsWith('<')?'<'+relocated+'>':relocated}${title})`;
 });
}
