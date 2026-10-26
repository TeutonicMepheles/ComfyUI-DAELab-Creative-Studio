import {registerHooks} from 'node:module';
import {existsSync,readFileSync} from 'node:fs';
import {fileURLToPath,pathToFileURL} from 'node:url';
import ts from 'typescript';

// Source ESM uses final .js URLs; the no-bundle product build emits these from TS.
registerHooks({
  resolve(specifier,context,next){
    if(context.parentURL&&specifier.startsWith('.')&&specifier.endsWith('.js')){
      const url=new URL(specifier,context.parentURL);
      if(url.protocol==='file:'){
        const path=fileURLToPath(url),source=path.slice(0,-3)+'.ts';
        if(!existsSync(path)&&existsSync(source))return {url:pathToFileURL(source).href,shortCircuit:true};
      }
    }
    return next(specifier,context);
  },
  load(url,context,next){
    if(url.endsWith('.ts'))return {format:'module',shortCircuit:true,source:ts.transpileModule(readFileSync(new URL(url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText};
    return next(url,context);
  },
});
