"""
health_endpoint.py - Backend proxy for 5 public Health APIs
"""
import os, logging, httpx
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from typing import List

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/health-apis", tags=["health-apis"])

NUTRITIONIX_APP_ID  = os.getenv("NUTRITIONIX_APP_ID", "")
NUTRITIONIX_APP_KEY = os.getenv("NUTRITIONIX_APP_KEY", "")
INFERMEDICA_APP_ID  = os.getenv("INFERMEDICA_APP_ID", "")
INFERMEDICA_APP_KEY = os.getenv("INFERMEDICA_APP_KEY", "")
TIMEOUT = 10

# 1. OPEN DISEASE (disease.sh)
@router.get("/disease")
async def get_disease_stats():
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            res = await client.get("https://disease.sh/v3/covid-19/all")
            res.raise_for_status()
            d = res.json()
            return {"cases":d.get("cases",0),"todayCases":d.get("todayCases",0),"deaths":d.get("deaths",0),"todayDeaths":d.get("todayDeaths",0),"recovered":d.get("recovered",0),"active":d.get("active",0),"updated":d.get("updated",0),"source":"disease.sh"}
    except Exception as e:
        logger.warning(f"disease.sh failed: {e}")
        return {"error":"Could not fetch disease stats","source":"disease.sh"}

# 2. MEDLINEPLUS CONNECT (NIH)
@router.get("/medline")
async def get_medline_health_info(query: str = Query(..., min_length=2)):
    url = "https://connect.medlineplus.gov/service"
    params = {"mainSearchCriteria.v.c": query, "mainSearchCriteria.v.cs": "2.16.840.1.113883.6.177", "knowledgeResponseType": "application/json", "informationRecipient.languageCode.c": "en"}
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            res = await client.get(url, params=params)
            res.raise_for_status()
            entries = res.json().get("feed",{}).get("entry",[])[:3]
            results = [{"title":e.get("title",{}).get("_value",""),"summary":e.get("summary",{}).get("_value","")[:300],"url":e.get("link",[{}])[0].get("href","")} for e in entries]
            return {"query":query,"results":results,"source":"MedlinePlus / NIH"}
    except Exception as e:
        logger.warning(f"MedlinePlus failed: {e}")
        return {"query":query,"results":[],"error":"Could not fetch NIH data","source":"MedlinePlus / NIH"}

# 3. NUTRITIONIX
class NutritionRequest(BaseModel):
    query: str

@router.post("/nutrition")
async def get_nutrition(body: NutritionRequest):
    if not NUTRITIONIX_APP_ID or not NUTRITIONIX_APP_KEY:
        return {"foods":[{"food_name":body.query,"nf_calories":0,"nf_protein":0,"nf_total_fat":0,"nf_total_carbohydrate":0,"serving_qty":1,"serving_unit":"serving"}],"demo":True,"message":"Add NUTRITIONIX_APP_ID and NUTRITIONIX_APP_KEY to .env for real data.","source":"Nutritionix"}
    headers = {"x-app-id":NUTRITIONIX_APP_ID,"x-app-key":NUTRITIONIX_APP_KEY,"Content-Type":"application/json"}
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            res = await client.post("https://trackapi.nutritionix.com/v2/natural/nutrients", json={"query":body.query}, headers=headers)
            res.raise_for_status()
            foods = [{"food_name":f.get("food_name",""),"nf_calories":f.get("nf_calories",0),"nf_protein":f.get("nf_protein",0),"nf_total_fat":f.get("nf_total_fat",0),"nf_total_carbohydrate":f.get("nf_total_carbohydrate",0),"serving_qty":f.get("serving_qty",1),"serving_unit":f.get("serving_unit","serving"),"photo":f.get("photo",{}).get("thumb","")} for f in res.json().get("foods",[])]
            return {"foods":foods,"source":"Nutritionix"}
    except Exception as e:
        raise HTTPException(502, f"Nutritionix error: {e}")

# 4. OPENFDA
@router.get("/drug")
async def get_drug_info(name: str = Query(..., min_length=2)):
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            res = await client.get("https://api.fda.gov/drug/label.json", params={"search":f'openfda.generic_name:"{name}" OR openfda.brand_name:"{name}"',"limit":1})
            if res.status_code == 404:
                return {"name":name,"found":False,"source":"OpenFDA"}
            res.raise_for_status()
            results = res.json().get("results",[])
            if not results:
                return {"name":name,"found":False,"source":"OpenFDA"}
            r = results[0]
            def first(key): val=r.get(key,[]); return val[0][:400] if val else None
            return {"name":name,"found":True,"brand_name":r.get("openfda",{}).get("brand_name",[name])[0],"generic_name":r.get("openfda",{}).get("generic_name",[name])[0],"purpose":first("purpose"),"warnings":first("warnings"),"dosage":first("dosage_and_administration"),"adverse_reactions":first("adverse_reactions"),"source":"OpenFDA"}
    except Exception as e:
        return {"name":name,"found":False,"error":str(e),"source":"OpenFDA"}

# 5. INFERMEDICA
class SymptomCheckRequest(BaseModel):
    age: int
    sex: str
    symptoms: List[str]

@router.post("/symptoms")
async def check_symptoms(body: SymptomCheckRequest):
    if not INFERMEDICA_APP_ID or not INFERMEDICA_APP_KEY:
        return {"conditions":[{"name":"Common Cold","probability":0.62,"common_name":"Common cold"},{"name":"Influenza","probability":0.28,"common_name":"Flu"},{"name":"Fatigue","probability":0.10,"common_name":"General fatigue"}],"demo":True,"message":"Add INFERMEDICA_APP_ID and INFERMEDICA_APP_KEY to .env for real AI diagnosis.","source":"Infermedica"}
    headers = {"App-Id":INFERMEDICA_APP_ID,"App-Key":INFERMEDICA_APP_KEY,"Content-Type":"application/json"}
    symptom_ids = []
    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        for sym in body.symptoms[:5]:
            try:
                r = await client.get("https://api.infermedica.com/v3/search", params={"phrase":sym,"types":"symptom"}, headers=headers)
                items = r.json() if r.status_code == 200 else []
                if items: symptom_ids.append({"id":items[0]["id"],"choice_id":"present"})
            except: pass
    if not symptom_ids:
        return {"conditions":[],"error":"No recognisable symptoms found","source":"Infermedica"}
    payload = {"sex":body.sex,"age":{"value":body.age},"evidence":symptom_ids}
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            res = await client.post("https://api.infermedica.com/v3/diagnosis", json=payload, headers=headers)
            res.raise_for_status()
            conditions = [{"name":c.get("name",""),"common_name":c.get("common_name",c.get("name","")),"probability":round(c.get("probability",0),2)} for c in res.json().get("conditions",[])[:3]]
            return {"conditions":conditions,"source":"Infermedica"}
    except Exception as e:
        raise HTTPException(502, f"Infermedica error: {e}")
