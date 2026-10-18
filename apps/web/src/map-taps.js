// Match MapLibre 5.12's 500 ms tap-drag window without preventing native gestures.
export function installMapTaps(map, select, {delay=500,now=Date.now,schedule=(...args)=>setTimeout(...args),cancel=id=>clearTimeout(id)}={}) {
  let timer,blockedUntil=0;
  const clear=()=>{if(timer!==undefined)cancel(timer);timer=undefined;};
  const gesture=()=>{clear();blockedUntil=now()+delay;};
  const click=event=>{
    clear();
    if(event.originalEvent?.detail>1||now()<blockedUntil||map.isMoving())return;
    timer=schedule(()=>{
      timer=undefined;
      if(now()>=blockedUntil&&!map.isMoving())select(event);
    },delay);
  };
  const handlers={click,touchstart:clear,mousedown:clear,touchcancel:clear,dblclick:gesture,movestart:clear,remove:clear};
  for(const [type,handler] of Object.entries(handlers))map.on(type,handler);
  return ()=>{clear();for(const [type,handler] of Object.entries(handlers))map.off(type,handler);};
}
