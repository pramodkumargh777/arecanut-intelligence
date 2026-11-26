import { useEffect } from "react";
import { useLocation } from "react-router-dom";
const API=(import.meta.env.VITE_API_BASE_URL??"http://127.0.0.1:8787/api/v1").replace(/\/$/,"");
function getId(){try{let id=localStorage.getItem("adike_anon_id");if(!id){id=Array.from(crypto.getRandomValues(new Uint8Array(18))).map(x=>x.toString(16).padStart(2,"0")).join("");localStorage.setItem("adike_anon_id",id)}return id}catch{return null}}
function getUtm(){try{const keys=["source","medium","campaign","content","term"];const params=new URLSearchParams(location.search);const current:any={};keys.forEach(k=>{const v=params.get("utm_"+k);if(v)current[k]=v});if(Object.keys(current).length){localStorage.setItem("adike_utm",JSON.stringify(current));return current}return JSON.parse(localStorage.getItem("adike_utm")||"{}")}catch{return {}}}
function emit(event:string,path:string){const id=getId();if(!id)return;fetch(API+"/events",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({event,anonymous_id:id,page_path:path,page_type:path.split("/")[1]||"home",utm:getUtm()})}).catch(()=>{})}
export function AnalyticsTracker(){const {pathname}=useLocation();useEffect(()=>{emit("page_view",pathname);try{const key="adike_return_seen";if(localStorage.getItem(key)){emit("return_visit",pathname)}else localStorage.setItem(key,"1")}catch{}},[pathname]);return null}
