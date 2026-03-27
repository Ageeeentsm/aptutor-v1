"""
Aptutor - Aptitude Test Preparation Platform
Beta mode: no signup/login required.
All sessions stored in-memory keyed by browser session ID.
"""

from flask import Flask, render_template, request, jsonify, session
import json, os, random
from datetime import datetime, date

app = Flask(__name__)
app.secret_key = "aptutor-beta-no-auth"
DATA_DIR = os.path.join(os.path.dirname(__file__), "data")

# ── In-memory test session store ──
TEST_SESSIONS = {}
_counter = [0]

def new_sid():
    _counter[0] += 1
    return _counter[0]

# ── Question loading ──
def load_questions(module=None, subtype=None, difficulty=None):
    files = {"gmat":"gmat_questions.json","shl":"shl_questions.json","watson":"watson_questions.json"}
    mods = [module] if module and module in files else list(files.keys())
    all_q = []
    for m in mods:
        p = os.path.join(DATA_DIR, files[m])
        if os.path.exists(p):
            with open(p) as f:
                all_q.extend(json.load(f))
    if subtype: all_q = [q for q in all_q if q.get("subtype")==subtype]
    if difficulty and difficulty!="all": all_q = [q for q in all_q if q.get("difficulty")==difficulty]
    if module: all_q = [q for q in all_q if q.get("module")==module]
    return all_q

def get_q(qid):
    for q in load_questions():
        if q["id"]==qid: return q
    return None

# ── Pages ──
@app.route("/")
def landing(): return render_template("landing.html")

@app.route("/app")
@app.route("/dashboard")
def dashboard(): return render_template("dashboard.html")

@app.route("/test")
def test_select(): return render_template("test_select.html")

@app.route("/study")
def study_page(): return render_template("study.html")

@app.route("/insights")
def insights_page(): return render_template("insights.html")

@app.route("/leaderboard")
def leaderboard_page(): return render_template("leaderboard.html")

# ── User stats (from current browser session) ──
@app.route("/api/user/stats")
def user_stats():
    my_ids = session.get("my_session_ids", [])
    sessions = [TEST_SESSIONS[i] for i in my_ids if i in TEST_SESSIONS and TEST_SESSIONS[i]["completed"]]
    total_correct = sum(s["score"] for s in sessions)
    total_q = sum(s["total"] for s in sessions)
    accuracy = round(total_correct/total_q*100,1) if total_q else 0
    all_pq = [p for s in sessions for p in s.get("per_question_data",[])]
    avg_time = round(sum(p.get("time",0) for p in all_pq)/len(all_pq),1) if all_pq else 0

    module_stats={}
    for s in sessions:
        m=s["module"]
        if m not in module_stats: module_stats[m]={"correct":0,"total":0}
        module_stats[m]["correct"]+=s["score"]; module_stats[m]["total"]+=s["total"]

    recent=[{"id":s["id"],"module":s["module"],"subtype":s["subtype"],"score":s["score"],
             "total":s["total"],"accuracy":round(s["score"]/s["total"]*100,1) if s["total"] else 0,
             "date":(s.get("completed_at") or "")[:10],"mode":s["mode"]}
            for s in sorted(sessions,key=lambda x:x.get("completed_at",""),reverse=True)[:10]]

    topic_stats={}
    for p in all_pq:
        t=p.get("topic","general")
        if t not in topic_stats: topic_stats[t]={"correct":0,"total":0}
        topic_stats[t]["total"]+=1
        if p.get("correct"): topic_stats[t]["correct"]+=1
    weak=[{"topic":t,"accuracy":round(d["correct"]/d["total"]*100,1),"total":d["total"]}
          for t,d in topic_stats.items() if d["total"]>=2]
    weak.sort(key=lambda x:x["accuracy"])

    return jsonify({"total_tests":len(sessions),"accuracy":accuracy,"avg_time":avg_time,
                    "streak":0,"module_stats":module_stats,"recent_tests":recent,
                    "weak_areas":weak[:5],"username":"Guest"})

# ── Test flow ──
@app.route("/test/start", methods=["POST"])
def start_test():
    d=request.get_json()
    module=d.get("module","gmat"); subtype=d.get("subtype","")
    difficulty=d.get("difficulty","all"); count=int(d.get("count",15)); mode=d.get("mode","timed")
    qs=load_questions(module=module,subtype=subtype or None,difficulty=difficulty)
    if not qs: return jsonify({"error":"No questions found"}),404
    random.shuffle(qs); sel=qs[:min(count,len(qs))]
    sid=new_sid()
    TEST_SESSIONS[sid]={"id":sid,"module":module,"subtype":subtype or "mixed","difficulty":difficulty,
        "mode":mode,"question_ids":[q["id"] for q in sel],"answers":{},"time_taken":0,
        "score":0,"total":len(sel),"completed":False,"started_at":datetime.now().isoformat(),
        "completed_at":None,"per_question_data":[]}
    ids=session.get("my_session_ids",[]); ids.append(sid); session["my_session_ids"]=ids
    return jsonify({"session_id":sid,"time_limit":len(sel)*90 if mode=="timed" else 0,
                    "total_questions":len(sel),"mode":mode})

@app.route("/test/<int:sid>")
def test_page(sid):
    if sid not in TEST_SESSIONS: return render_template("test_select.html")
    return render_template("test.html", session_id=sid)

@app.route("/api/test/<int:sid>/question/<int:idx>")
def get_question(sid,idx):
    t=TEST_SESSIONS.get(sid)
    if not t: return jsonify({"error":"Not found"}),404
    qids=t["question_ids"]
    if idx>=len(qids): return jsonify({"error":"Index out of range"}),400
    q=get_q(qids[idx])
    if not q: return jsonify({"error":"Question missing"}),404
    out={"id":q["id"],"index":idx,"total":len(qids),"question":q["question"],"options":q["options"],
         "difficulty":q["difficulty"],"topic":q["topic"],"module":q["module"],"subtype":q["subtype"],
         "avg_time_seconds":q.get("avg_time_seconds",60),"mode":t["mode"],"selected":t["answers"].get(str(idx))}
    if t["mode"]=="study" and str(idx) in t["answers"]:
        out.update({"correct":q["correct"],"explanation":q["explanation"],"deep_explanation":q["deep_explanation"]})
    return jsonify(out)

@app.route("/api/test/<int:sid>/answer", methods=["POST"])
def submit_answer(sid):
    t=TEST_SESSIONS.get(sid)
    if not t: return jsonify({"error":"Not found"}),404
    d=request.get_json(); idx=d.get("index"); ans=d.get("answer")
    t["answers"][str(idx)]=ans
    q=get_q(t["question_ids"][idx])
    is_correct=q["correct"]==ans if q else False
    resp={"saved":True}
    if t["mode"]=="study" and q:
        resp.update({"correct":q["correct"],"is_correct":is_correct,
                     "explanation":q["explanation"],"deep_explanation":q["deep_explanation"]})
    return jsonify(resp)

@app.route("/api/test/<int:sid>/submit", methods=["POST"])
def submit_test(sid):
    t=TEST_SESSIONS.get(sid)
    if not t: return jsonify({"error":"Not found"}),404
    d=request.get_json(); time_taken=d.get("time_taken",0); pqt=d.get("per_question_times",{})
    score=0; pqd=[]
    for i,qid in enumerate(t["question_ids"]):
        q=get_q(qid)
        if not q: continue
        ua=t["answers"].get(str(i)); ic=q["correct"]==ua
        if ic: score+=1
        pqd.append({"index":i,"question_id":qid,"topic":q.get("topic","general"),
                    "difficulty":q.get("difficulty","medium"),"user_answer":ua,
                    "correct_answer":q["correct"],"correct":ic,"time":pqt.get(str(i),0)})
    total=len(t["question_ids"])
    t.update({"score":score,"total":total,"completed":True,"time_taken":time_taken,
              "completed_at":datetime.now().isoformat(),"per_question_data":pqd})
    return jsonify({"score":score,"total":total,"percentage":round(score/total*100,1) if total else 0,
                    "session_id":sid,"redirect":f"/results/{sid}"})

# ── Results ──
@app.route("/results/<int:sid>")
def results_page(sid): return render_template("results.html", session_id=sid)

@app.route("/api/results/<int:sid>")
def get_results(sid):
    t=TEST_SESSIONS.get(sid)
    if not t: return jsonify({"error":"Not found"}),404
    pqd=t.get("per_question_data",[])
    questions_detail=[]
    for pq in pqd:
        q=get_q(pq["question_id"])
        if q: questions_detail.append({**pq,"question":q["question"],"options":q["options"],
                                        "explanation":q["explanation"],"deep_explanation":q["deep_explanation"]})
    topic_summary={}
    for pq in pqd:
        tt=pq.get("topic","general")
        if tt not in topic_summary: topic_summary[tt]={"correct":0,"total":0}
        topic_summary[tt]["total"]+=1
        if pq["correct"]: topic_summary[tt]["correct"]+=1
    topic_list=[{"topic":t2.replace("_"," ").title(),"correct":d["correct"],"total":d["total"],
                 "accuracy":round(d["correct"]/d["total"]*100,1),
                 "status":"strong" if round(d["correct"]/d["total"]*100,1)>=70 else("average" if round(d["correct"]/d["total"]*100,1)>=50 else "weak")}
                for t2,d in topic_summary.items()]
    times=[pq.get("time",0) for pq in pqd]
    avg_time=round(sum(times)/len(times),1) if times else 0
    total=t["total"]; score=t["score"]; pct=round(score/total*100,1) if total else 0
    return jsonify({"session_id":sid,"module":t["module"],"subtype":t["subtype"],"score":score,
                    "total":total,"percentage":pct,"passed":pct>=60,"time_taken":t["time_taken"],
                    "avg_time_per_question":avg_time,"topic_breakdown":topic_list,
                    "questions":questions_detail,"completed_at":t.get("completed_at","")})

# ── Insights ──
@app.route("/api/insights")
def get_insights():
    qs=load_questions(module=request.args.get("module") or None,
                      subtype=request.args.get("subtype") or None,
                      difficulty=request.args.get("difficulty") or None)
    search=request.args.get("search","").lower()
    if search: qs=[q for q in qs if search in q["question"].lower() or search in q.get("topic","").lower()]
    return jsonify({"questions":qs,"total":len(qs)})

# ── Daily Challenge ──
@app.route("/api/daily-challenge")
def daily_challenge():
    today=date.today().isoformat()
    all_q=load_questions(); random.seed(today)
    sel=random.sample(all_q,min(5,len(all_q))); random.seed()
    return jsonify({"date":today,"total":len(sel),
                    "questions":[{"id":q["id"],"module":q["module"],"difficulty":q["difficulty"]} for q in sel]})

# ── Leaderboard (session-local) ──
@app.route("/api/leaderboard")
def get_leaderboard():
    mf=request.args.get("module")
    my_ids=session.get("my_session_ids",[])
    completed=[TEST_SESSIONS[i] for i in my_ids if i in TEST_SESSIONS and TEST_SESSIONS[i]["completed"]]
    if mf: completed=[s for s in completed if s["module"]==mf]
    if not completed:
        return jsonify({"rankings":[],"beta_note":"Complete a test to appear here."})
    ts=sum(s["score"] for s in completed); tq=sum(s["total"] for s in completed)
    acc=round(ts/tq*100,1) if tq else 0
    return jsonify({"rankings":[{"rank":1,"username":"You (Beta)","tests_taken":len(completed),
                                  "total_score":ts,"accuracy":acc,"is_current":True}],
                    "beta_note":"Multi-user leaderboard coming after beta."})


# ── Career / Employer section ──
@app.route("/careers")
def careers_page(): return render_template("careers.html")

@app.route("/api/careers")
def get_careers():
    import json
    path = os.path.join(DATA_DIR, "career_profiles.json")
    with open(path) as f:
        profiles = json.load(f)
    return jsonify(profiles)

@app.route("/api/careers/<career_id>/questions")
def career_questions(career_id):
    import json
    path = os.path.join(DATA_DIR, "career_profiles.json")
    with open(path) as f:
        profiles = json.load(f)
    profile = profiles.get(career_id)
    if not profile:
        return jsonify({"error": "Career not found"}), 404
    topics = profile.get("sample_topics", [])
    difficulty = profile.get("difficulty", "all")
    all_q = load_questions()
    filtered = [q for q in all_q if q.get("topic") in topics]
    if not filtered:
        filtered = all_q
    random.shuffle(filtered)
    return jsonify({"career": profile, "questions": filtered[:15], "total": len(filtered)})

# ── Learn / Curriculum section ──
@app.route("/learn")
def learn_page(): return render_template("learn.html")

@app.route("/api/curriculum")
def get_curriculum():
    import json
    path = os.path.join(DATA_DIR, "curriculum.json")
    with open(path) as f:
        data = json.load(f)
    return jsonify(data)

@app.route("/api/daily-lecture")
def daily_lecture():
    import json
    path = os.path.join(DATA_DIR, "curriculum.json")
    with open(path) as f:
        data = json.load(f)
    lectures = data.get("daily_lectures", [])
    if not lectures:
        return jsonify({"error": "No lectures"}), 404
    # Rotate by day of year
    from datetime import date
    day_idx = date.today().timetuple().tm_yday % len(lectures)
    lecture = lectures[day_idx]
    # Attach question if referenced
    if lecture.get("quiz_question"):
        q = get_q(lecture["quiz_question"])
        if q:
            lecture["question"] = q
    return jsonify(lecture)

# ── Chatbot ──
INTENT_KW={"explain":["explain","what","how","why","understand","confused","mean"],
            "shortcut":["shortcut","quick","trick","tip","hack","strategy","method","fast"],
            "why_wrong":["wrong","mistake","incorrect","why not","why did","my answer"],
            "general_tip":["help","advice","improve","better","score","pass"]}
MOD_TIPS={"gmat":"For GMAT: eliminate wrong options first, estimate for complex calculations, test data sufficiency statements independently.",
           "shl":"For SHL: read tables carefully, track what's asked vs given, watch percentage-change vs absolute-change.",
           "watson":"For Watson-Glaser: stick strictly to the given information. No outside knowledge or unstated assumptions.",
           "default":"Time-box at 90s per question. Eliminate 2 obvious wrong options, then choose between the remaining 2."}

def detect_intent(msg):
    msg=msg.lower()
    for intent,kws in INTENT_KW.items():
        if any(k in msg for k in kws): return intent
    return "general_tip"

@app.route("/api/chatbot", methods=["POST"])
def chatbot():
    d=request.get_json(); msg=d.get("message",""); qid=d.get("question_id"); ua=d.get("user_answer")
    intent=detect_intent(msg); q=get_q(qid) if qid else None; de=q.get("deep_explanation",{}) if q else {}
    if q:
        if intent=="explain": resp=f"**{q['topic'].replace('_',' ').title()}:**\n\n{q['explanation']}\n\n⚡ {de.get('strategy_tip','')}"
        elif intent=="shortcut": resp=f"⚡ **Strategy:**\n{de.get('strategy_tip','Eliminate 2 wrong options first.')}"
        elif intent=="why_wrong" and ua:
            why=de.get("why_wrong",{}).get(ua,"Doesn't satisfy all question conditions.")
            resp=f"❌ **Why {ua} is wrong:**\n{why}\n\n✅ **Correct ({q['correct']}):** {q['explanation']}"
        elif intent=="why_wrong": resp=f"✅ **Correct answer: {q['correct']}**\n\n{q['explanation']}"
        else: resp=MOD_TIPS.get(q.get("module","default"),MOD_TIPS["default"])
    else:
        resp="👋 Ask me to **explain** the current question, give a **shortcut**, or tell you **why your answer was wrong**. Navigate to a question first!"
    return jsonify({"response":resp,"intent":intent,"timestamp":datetime.now().strftime("%H:%M")})

if __name__=="__main__":
    import os
    port = int(os.environ.get("PORT", 5000))
    debug = os.environ.get("RENDER") is None  # no debug on Render
    print(f"🚀 Aptutor running on http://localhost:{port}")
    app.run(debug=debug, host="0.0.0.0", port=port)
