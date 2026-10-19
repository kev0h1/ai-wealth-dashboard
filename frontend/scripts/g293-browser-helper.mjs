// Manual synthetic browser checks only. Never imported by production UI.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { get } from "node:http";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export async function openBrowser({origin,output}) {
  assert.ok(output&&path.isAbsolute(output),"Absolute scratch evidence path required");
  await mkdir(output,{recursive:true});
  const profile=await mkdtemp(path.join(tmpdir(),"sorted-design-chrome-"));
  const chrome=spawn("/usr/bin/google-chrome",["--headless=new","--no-sandbox","--disable-dev-shm-usage","--remote-debugging-address=127.0.0.1","--remote-debugging-port=0",`--user-data-dir=${profile}`,"about:blank"],{stdio:"ignore"});
  let socket;
  const close=()=>{socket?.close();chrome.kill("SIGTERM");};
  try {
    let port;
    for(let n=0;n<100;n++){try{port=(await readFile(path.join(profile,"DevToolsActivePort"),"utf8")).split("\n")[0];break;}catch{await delay(100);}}
    assert.ok(port,"Chrome debugging port");
    const info=await new Promise((resolve,reject)=>{
      const request=get({hostname:"127.0.0.1",port,path:"/json/version"},response=>{
        let body="";response.setEncoding("utf8");response.on("data",chunk=>{body+=chunk;});
        response.on("error",reject);response.on("end",()=>{try{assert.equal(response.statusCode,200);resolve(JSON.parse(body));}catch(error){reject(error);}});
      });request.on("error",reject);request.setTimeout(5000,()=>request.destroy(new Error("Chrome metadata timeout")));
    });
    socket=new WebSocket(info.webSocketDebuggerUrl);
    await new Promise((resolve,reject)=>{socket.addEventListener("open",resolve,{once:true});socket.addEventListener("error",reject,{once:true});});
    let seq=0;
    const pending=new Map(),exceptions=[],apiRequests=[];
    socket.addEventListener("message",({data})=>{
      const m=JSON.parse(String(data));
      if(m.method==="Runtime.exceptionThrown")exceptions.push(m.params.exceptionDetails.exception?.description??m.params.exceptionDetails.text);
      if(m.method==="Network.requestWillBeSent"&&/\/api\//.test(m.params.request.url))apiRequests.push(m.params.request.url);
      const task=pending.get(m.id);if(!task)return;pending.delete(m.id);clearTimeout(task.timer);
      if(m.error)task.reject(new Error(`${task.method}: ${JSON.stringify(m.error)}`));else task.resolve(m.result);
    });
    const send=(method,params={},sessionId)=>new Promise((resolve,reject)=>{
      const id=++seq,timer=setTimeout(()=>{pending.delete(id);reject(new Error(`CDP timeout ${method}`));},45000);
      pending.set(id,{resolve,reject,timer,method});socket.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));
    });
    const {targetId}=await send("Target.createTarget",{url:"about:blank"});
    const {sessionId}=await send("Target.attachToTarget",{targetId,flatten:true});
    const call=(method,params)=>send(method,params,sessionId);
    await call("Page.enable");await call("Runtime.enable");await call("Network.enable");
    await call("Network.setBlockedURLs",{urls:["*/api/*","https://*"]});
    await call("Emulation.setEmulatedMedia",{features:[{name:"prefers-reduced-motion",value:"reduce"}]});
    const evaluate=async expression=>{
      const r=await call("Runtime.evaluate",{expression,returnByValue:true,awaitPromise:true});
      if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails));return r.result.value;
    };
    const waitFor=async expression=>{
      for(let n=0;n<160;n++){if(await evaluate(`!!(${expression})`))return;await delay(100);}
      throw new Error(`Timed out: ${expression}; ${JSON.stringify(await evaluate("({url:location.href,text:document.body.innerText.slice(-1400)})"))}`);
    };
    const settle=async()=>{await evaluate("document.fonts.ready.then(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r(true)))))");await delay(100);};
    const viewport=async(width,height=900)=>{
      await call("Emulation.setDeviceMetricsOverride",{width,height,deviceScaleFactor:1,mobile:width<600});
      await call("Emulation.setTouchEmulationEnabled",{enabled:width<600});
    };
    const navigate=async(route,ready)=>{
      await call("Page.navigate",{url:"about:blank"});await waitFor("location.href==='about:blank'");
      await call("Page.navigate",{url:origin+route});await waitFor(ready);await settle();
    };
    const activate=async(selector,touch=true)=>{
      const box=await evaluate(`(()=>{const e=${selector};if(!e)throw Error('Missing control');e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()`);
      if(touch){await call("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[box]});await call("Input.dispatchTouchEvent",{type:"touchEnd",touchPoints:[]});}
      else{await call("Input.dispatchMouseEvent",{type:"mousePressed",...box,button:"left",clickCount:1});await call("Input.dispatchMouseEvent",{type:"mouseReleased",...box,button:"left",clickCount:1});}
    };
    const key=async(key,code,keyCode)=>{
      await call("Input.dispatchKeyEvent",{type:"keyDown",key,code,windowsVirtualKeyCode:keyCode,nativeVirtualKeyCode:keyCode,...(key==="Enter"?{text:"\r",unmodifiedText:"\r"}:{})});
      await call("Input.dispatchKeyEvent",{type:"keyUp",key,code,windowsVirtualKeyCode:keyCode,nativeVirtualKeyCode:keyCode});
    };
    const type=async(selector,text)=>{
      await evaluate(`(()=>{const e=${selector};e.focus();e.select();})()`);
      await call("Input.insertText",{text});
    };
    const shot=async(name,{full=false}={})=>{
      await settle();if(full)await evaluate("scrollTo(0,0)");
      const metrics=await call("Page.getLayoutMetrics");
      const clip=full?{x:0,y:0,width:metrics.cssContentSize.width,height:metrics.cssContentSize.height,scale:1}:null;
      const r=await call("Page.captureScreenshot",{format:"png",captureBeyondViewport:full,...(clip?{clip}:{})});
      await writeFile(path.join(output,name+".png"),Buffer.from(r.data,"base64"));
    };
    return {call,evaluate,waitFor,settle,viewport,navigate,activate,key,type,shot,close,exceptions,apiRequests,output,
      save:async(name,data)=>writeFile(path.join(output,name+".json"),JSON.stringify(data,null,2))};
  }catch(error){close();throw error;}
}
