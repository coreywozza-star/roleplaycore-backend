import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import pool from "./db.js";

dotenv.config();
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: ["http://localhost:5173", "https://roleplaycore.xyz", process.env.FRONTEND_ORIGIN].filter(Boolean), credentials: true }));
app.use(express.json());
app.use((req, res, next) => { console.log(`🌐 ${req.method} ${req.url}`); next(); });

const slugify = (v) => String(v || "").toLowerCase().trim().replace(/['"]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const codeify = (v) => String(v || "").trim().replace(/\s+/g, "").toUpperCase();

async function requireCommunity(req, res, next) {
  try {
    const result = await pool.query("SELECT * FROM communities WHERE access_code=$1", [codeify(req.params.code)]);
    if (!result.rows[0]) return res.status(404).json({ error: "Community not found" });
    req.community = result.rows[0];
    next();
  } catch (err) { console.error(err); res.status(500).json({ error: "Failed to load community" }); }
}
async function requireRegiment(req, res, next) {
  try {
    const result = await pool.query("SELECT * FROM regiments WHERE community_id=$1 AND slug=$2", [req.community.id, req.params.regimentSlug]);
    if (!result.rows[0]) return res.status(404).json({ error: "Regiment not found" });
    req.regiment = result.rows[0];
    next();
  } catch (err) { console.error(err); res.status(500).json({ error: "Failed to load regiment" }); }
}
async function seedRegiment(regimentId) {
  const ranks = [["Private",1,1],["Private First Class",2,2],["Lance Corporal",3,2],["Corporal",4,3],["Sergeant",5,5],["Staff Sergeant",6,5],["Master Sergeant",7,6],["First Sergeant",8,6],["Sergeant Major",9,7],["Warrant Officer",10,7],["Officer Cadet",11,7],["2nd Lieutenant",12,10],["Lieutenant",13,10],["Captain",14,14],["Major",15,14],["Colonel",16,14],["Battalion Commander",17,21],["Commander",18,21],["Senior Commander",19,28],["Brigadier",20,0]];
  for (const r of ranks) await pool.query("INSERT INTO ranks (regiment_id,name,rank_order,cooldown_days) VALUES ($1,$2,$3,$4) ON CONFLICT (regiment_id,name) DO NOTHING", [regimentId, ...r]);
  for (const name of ["Member","Squad Lead","2IC","Specialist","Instructor"]) await pool.query("INSERT INTO unit_roles (regiment_id,name) VALUES ($1,$2) ON CONFLICT (regiment_id,name) DO NOTHING", [regimentId, name]);
  for (const m of [["Distinguished Service","Awarded for outstanding service.","🏅"],["Combat Efficiency Ribbon","Awarded for combat performance.","🎖️"],["Recruitment Ribbon","Awarded for recruitment work.","📣"]]) await pool.query("INSERT INTO medals (regiment_id,name,description,icon) VALUES ($1,$2,$3,$4) ON CONFLICT (regiment_id,name) DO NOTHING", [regimentId, ...m]);
}

app.get("/", (req, res) => res.json({ ok: true, message: "RoleplayCore community backend online" }));
app.get("/setup-db", async (req, res) => {
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS communities (id SERIAL PRIMARY KEY,name TEXT NOT NULL,access_code TEXT UNIQUE NOT NULL,description TEXT,theme TEXT DEFAULT 'imperial-red',logo_url TEXT,public_view BOOLEAN DEFAULT true,owner_name TEXT,owner_discord_id TEXT,owner_role_id TEXT,era TEXT DEFAULT 'imperial',created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);`);
        await pool.query(`ALTER TABLE communities ADD COLUMN IF NOT EXISTS owner_discord_id TEXT;`);
    await pool.query(`ALTER TABLE communities ADD COLUMN IF NOT EXISTS owner_role_id TEXT;`);
    await pool.query(`ALTER TABLE communities ADD COLUMN IF NOT EXISTS era TEXT DEFAULT 'imperial';`);
    await pool.query(`CREATE TABLE IF NOT EXISTS regiments (id SERIAL PRIMARY KEY,community_id INT REFERENCES communities(id) ON DELETE CASCADE,name TEXT NOT NULL,slug TEXT NOT NULL,description TEXT,theme TEXT,guild_id TEXT,officer_role_id TEXT,squad_lead_role_id TEXT,nco_role_id TEXT,webhook_staff TEXT,webhook_members TEXT,webhook_maintenance TEXT,created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,UNIQUE(community_id,slug));`);
    await pool.query(`CREATE TABLE IF NOT EXISTS ranks (id SERIAL PRIMARY KEY,regiment_id INT REFERENCES regiments(id) ON DELETE CASCADE,name TEXT NOT NULL,rank_order INT NOT NULL,cooldown_days INT DEFAULT 0,discord_role_id TEXT,UNIQUE(regiment_id,name));`);
    await pool.query(`CREATE TABLE IF NOT EXISTS players (id SERIAL PRIMARY KEY,regiment_id INT REFERENCES regiments(id) ON DELETE CASCADE,name TEXT NOT NULL,discord TEXT,discord_id TEXT,rank_name TEXT NOT NULL DEFAULT 'Private',service_number TEXT,sub_regiment TEXT DEFAULT '',unit_role TEXT DEFAULT 'Member',status TEXT DEFAULT 'Active',date_promoted DATE,last_promoted TIMESTAMP,created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);`);
    await pool.query(`CREATE TABLE IF NOT EXISTS tasks (id SERIAL PRIMARY KEY,regiment_id INT REFERENCES regiments(id) ON DELETE CASCADE,title TEXT NOT NULL,group_name TEXT DEFAULT 'Trooper',rank_name TEXT DEFAULT 'ALL',sub_regiment TEXT DEFAULT 'ALL',created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);`);
    await pool.query(`CREATE TABLE IF NOT EXISTS unit_roles (id SERIAL PRIMARY KEY,regiment_id INT REFERENCES regiments(id) ON DELETE CASCADE,name TEXT NOT NULL,created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,UNIQUE(regiment_id,name));`);
    await pool.query(`CREATE TABLE IF NOT EXISTS medals (id SERIAL PRIMARY KEY,regiment_id INT REFERENCES regiments(id) ON DELETE CASCADE,name TEXT NOT NULL,description TEXT,icon TEXT DEFAULT '🏅',created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,UNIQUE(regiment_id,name));`);
    await pool.query(`CREATE TABLE IF NOT EXISTS player_medals (id SERIAL PRIMARY KEY,player_id INT REFERENCES players(id) ON DELETE CASCADE,medal_id INT REFERENCES medals(id) ON DELETE CASCADE,awarded_by TEXT,reason TEXT,awarded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);`);
    await pool.query(`CREATE TABLE IF NOT EXISTS discipline_records (id SERIAL PRIMARY KEY,regiment_id INT REFERENCES regiments(id) ON DELETE CASCADE,player_id INT REFERENCES players(id) ON DELETE CASCADE,type TEXT NOT NULL,reason TEXT NOT NULL,issued_by TEXT,status TEXT DEFAULT 'Active',expires_at DATE,created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);`);
    await pool.query(`CREATE TABLE IF NOT EXISTS announcements (id SERIAL PRIMARY KEY,community_id INT REFERENCES communities(id) ON DELETE CASCADE,regiment_id INT REFERENCES regiments(id) ON DELETE CASCADE,message TEXT NOT NULL,officer TEXT,active BOOLEAN DEFAULT true,created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);`);
    res.json({ ok: true, message: "RoleplayCore community database ready" });
  } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
});

app.get("/communities", async (req,res)=>{ const r=await pool.query("SELECT * FROM communities ORDER BY created_at DESC"); res.json(r.rows); });
app.post("/communities", async (req,res)=>{ try { const b=req.body; const name=String(b.name||"").trim(); const code=codeify(b.access_code||name); if(!name||!code) return res.status(400).json({error:"Community name and access code required"}); const r=await pool.query("INSERT INTO communities (name,access_code,description,theme,logo_url,public_view,owner_name,owner_discord_id,owner_role_id,era) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *",[name,code,b.description||"",b.theme||"imperial-ground",b.logo_url||"",b.public_view!==false,b.owner_name||"",b.owner_discord_id||"",b.owner_role_id||"",b.era||"imperial"]); res.json(r.rows[0]); } catch(e){ console.error(e); res.status(500).json({error:"Failed to create community. Code may already exist."}); }});
app.get("/communities/:code", requireCommunity, (req,res)=>res.json(req.community));
app.delete("/communities/:code", requireCommunity, async (req,res)=>{ try { await pool.query("DELETE FROM communities WHERE id=$1",[req.community.id]); res.json({ok:true}); } catch(e){ console.error(e); res.status(500).json({error:"Failed to delete community"}); }});

app.patch("/communities/:code", requireCommunity, async (req,res)=>{ const b=req.body; const r=await pool.query("UPDATE communities SET name=COALESCE($1,name),description=COALESCE($2,description),theme=COALESCE($3,theme),logo_url=COALESCE($4,logo_url),public_view=COALESCE($5,public_view),owner_name=COALESCE($6,owner_name),owner_discord_id=COALESCE($7,owner_discord_id),owner_role_id=COALESCE($8,owner_role_id),era=COALESCE($9,era) WHERE id=$10 RETURNING *",[b.name||null,b.description||null,b.theme||null,b.logo_url||null,typeof b.public_view==='boolean'?b.public_view:null,b.owner_name||null,b.owner_discord_id||null,b.owner_role_id||null,b.era||null,req.community.id]); res.json(r.rows[0]); });

app.get("/communities/:code/regiments", requireCommunity, async (req,res)=>{ const r=await pool.query("SELECT * FROM regiments WHERE community_id=$1 ORDER BY created_at DESC",[req.community.id]); res.json(r.rows); });
app.post("/communities/:code/regiments", requireCommunity, async (req,res)=>{ try { const b=req.body; const name=String(b.name||"").trim(); const slug=slugify(b.slug||name); if(!name||!slug) return res.status(400).json({error:"Regiment name required"}); const r=await pool.query("INSERT INTO regiments (community_id,name,slug,description,theme,guild_id,officer_role_id,squad_lead_role_id,nco_role_id,webhook_staff,webhook_members,webhook_maintenance) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *",[req.community.id,name,slug,b.description||"",b.theme||req.community.theme||"imperial-red",b.guild_id||"",b.officer_role_id||"",b.squad_lead_role_id||"",b.nco_role_id||"",b.webhook_staff||"",b.webhook_members||"",b.webhook_maintenance||""]); await seedRegiment(r.rows[0].id); res.json(r.rows[0]); } catch(e){ console.error(e); res.status(500).json({error:"Failed to create regiment. Slug may already exist."}); }});
app.get("/communities/:code/regiments/:regimentSlug", requireCommunity, requireRegiment, (req,res)=>res.json(req.regiment));
app.delete("/communities/:code/regiments/:regimentSlug", requireCommunity, requireRegiment, async (req,res)=>{ try { await pool.query("DELETE FROM regiments WHERE id=$1 AND community_id=$2",[req.regiment.id,req.community.id]); res.json({ok:true}); } catch(e){ console.error(e); res.status(500).json({error:"Failed to delete regiment"}); }});

app.patch("/communities/:code/regiments/:regimentSlug", requireCommunity, requireRegiment, async (req,res)=>{ const b=req.body; const r=await pool.query("UPDATE regiments SET name=COALESCE($1,name),description=COALESCE($2,description),theme=COALESCE($3,theme),guild_id=COALESCE($4,guild_id),officer_role_id=COALESCE($5,officer_role_id),squad_lead_role_id=COALESCE($6,squad_lead_role_id),nco_role_id=COALESCE($7,nco_role_id),webhook_staff=COALESCE($8,webhook_staff),webhook_members=COALESCE($9,webhook_members),webhook_maintenance=COALESCE($10,webhook_maintenance) WHERE id=$11 RETURNING *",[b.name||null,b.description||null,b.theme||null,b.guild_id||null,b.officer_role_id||null,b.squad_lead_role_id||null,b.nco_role_id||null,b.webhook_staff||null,b.webhook_members||null,b.webhook_maintenance||null,req.regiment.id]); res.json(r.rows[0]); });

const basePath = "/communities/:code/regiments/:regimentSlug";
app.get(basePath+"/ranks", requireCommunity, requireRegiment, async (req,res)=>{ const r=await pool.query("SELECT * FROM ranks WHERE regiment_id=$1 ORDER BY rank_order ASC",[req.regiment.id]); res.json(r.rows); });
app.post(basePath+"/ranks", requireCommunity, requireRegiment, async (req,res)=>{ const b=req.body; const r=await pool.query("INSERT INTO ranks (regiment_id,name,rank_order,cooldown_days,discord_role_id) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (regiment_id,name) DO UPDATE SET rank_order=EXCLUDED.rank_order,cooldown_days=EXCLUDED.cooldown_days,discord_role_id=EXCLUDED.discord_role_id RETURNING *",[req.regiment.id,b.name,Number(b.rank_order||1),Number(b.cooldown_days||0),b.discord_role_id||""]); res.json(r.rows[0]); });

app.patch(basePath+"/ranks/:id", requireCommunity, requireRegiment, async (req,res)=>{ const b=req.body; const r=await pool.query("UPDATE ranks SET name=COALESCE($1,name),rank_order=COALESCE($2,rank_order),cooldown_days=COALESCE($3,cooldown_days),discord_role_id=COALESCE($4,discord_role_id) WHERE id=$5 AND regiment_id=$6 RETURNING *",[b.name||null,typeof b.rank_order==="number"?b.rank_order:null,typeof b.cooldown_days==="number"?b.cooldown_days:null,b.discord_role_id||null,req.params.id,req.regiment.id]); res.json(r.rows[0]); });
app.delete(basePath+"/ranks/:id", requireCommunity, requireRegiment, async (req,res)=>{ await pool.query("DELETE FROM ranks WHERE id=$1 AND regiment_id=$2",[req.params.id,req.regiment.id]); res.json({ok:true}); });

app.get(basePath+"/players", requireCommunity, requireRegiment, async (req,res)=>{ const r=await pool.query("SELECT * FROM players WHERE regiment_id=$1 ORDER BY id DESC",[req.regiment.id]); res.json(r.rows); });
app.post(basePath+"/players", requireCommunity, requireRegiment, async (req,res)=>{ const b=req.body; const r=await pool.query("INSERT INTO players (regiment_id,name,discord,discord_id,rank_name,service_number,sub_regiment,unit_role,status,date_promoted) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *",[req.regiment.id,b.name,b.discord||"",b.discord_id||"",b.rank_name||"Private",b.service_number||"",b.sub_regiment||"",b.unit_role||"Member",b.status||"Active",b.date_promoted||new Date().toISOString().slice(0,10)]); res.json(r.rows[0]); });
app.delete(basePath+"/players/:id", requireCommunity, requireRegiment, async (req,res)=>{ await pool.query("DELETE FROM players WHERE id=$1 AND regiment_id=$2",[req.params.id,req.regiment.id]); res.json({ok:true}); });
app.get(basePath+"/tasks", requireCommunity, requireRegiment, async (req,res)=>{ const r=await pool.query("SELECT * FROM tasks WHERE regiment_id=$1 ORDER BY id DESC",[req.regiment.id]); res.json(r.rows); });
app.post(basePath+"/tasks", requireCommunity, requireRegiment, async (req,res)=>{ const b=req.body; const r=await pool.query("INSERT INTO tasks (regiment_id,title,group_name,rank_name,sub_regiment) VALUES ($1,$2,$3,$4,$5) RETURNING *",[req.regiment.id,b.title,b.group_name||"Trooper",b.rank_name||"ALL",b.sub_regiment||"ALL"]); res.json(r.rows[0]); });
app.delete(basePath+"/tasks/:id", requireCommunity, requireRegiment, async (req,res)=>{ await pool.query("DELETE FROM tasks WHERE id=$1 AND regiment_id=$2",[req.params.id,req.regiment.id]); res.json({ok:true}); });
app.get(basePath+"/medals", requireCommunity, requireRegiment, async (req,res)=>{ const r=await pool.query("SELECT * FROM medals WHERE regiment_id=$1 ORDER BY name ASC",[req.regiment.id]); res.json(r.rows); });
app.post(basePath+"/medals", requireCommunity, requireRegiment, async (req,res)=>{ const b=req.body; const r=await pool.query("INSERT INTO medals (regiment_id,name,description,icon) VALUES ($1,$2,$3,$4) ON CONFLICT (regiment_id,name) DO UPDATE SET description=EXCLUDED.description,icon=EXCLUDED.icon RETURNING *",[req.regiment.id,b.name,b.description||"",b.icon||"🏅"]); res.json(r.rows[0]); });
app.get(basePath+"/player-medals", requireCommunity, requireRegiment, async (req,res)=>{ const r=await pool.query("SELECT pm.*,m.name,m.description,m.icon,p.name AS player_name FROM player_medals pm JOIN medals m ON m.id=pm.medal_id JOIN players p ON p.id=pm.player_id WHERE p.regiment_id=$1 ORDER BY pm.awarded_at DESC",[req.regiment.id]); res.json(r.rows); });
app.get(basePath+"/discipline-records", requireCommunity, requireRegiment, async (req,res)=>{ const r=await pool.query("SELECT dr.*,p.name AS player_name,p.rank_name FROM discipline_records dr JOIN players p ON p.id=dr.player_id WHERE dr.regiment_id=$1 ORDER BY dr.created_at DESC",[req.regiment.id]); res.json(r.rows); });
app.post(basePath+"/players/:id/discipline-records", requireCommunity, requireRegiment, async (req,res)=>{ const b=req.body; const r=await pool.query("INSERT INTO discipline_records (regiment_id,player_id,type,reason,issued_by,status,expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *",[req.regiment.id,req.params.id,b.type||"Written Warning",b.reason||"No reason",b.issued_by||"",b.status||"Active",b.expires_at||null]); res.json(r.rows[0]); });
app.get("/communities/:code/announcements", requireCommunity, async (req,res)=>{ const r=await pool.query("SELECT * FROM announcements WHERE community_id=$1 AND regiment_id IS NULL AND active=true ORDER BY id DESC LIMIT 1",[req.community.id]); res.json(r.rows[0]||null); });
app.post("/communities/:code/announcements", requireCommunity, async (req,res)=>{ const b=req.body; await pool.query("UPDATE announcements SET active=false WHERE community_id=$1 AND regiment_id IS NULL",[req.community.id]); const r=await pool.query("INSERT INTO announcements (community_id,message,officer,active) VALUES ($1,$2,$3,true) RETURNING *",[req.community.id,b.message,b.officer||"Community Command"]); res.json(r.rows[0]); });
app.get(basePath+"/announcements", requireCommunity, requireRegiment, async (req,res)=>{ const r=await pool.query("SELECT * FROM announcements WHERE regiment_id=$1 AND active=true ORDER BY id DESC LIMIT 1",[req.regiment.id]); res.json(r.rows[0]||null); });
app.post(basePath+"/announcements", requireCommunity, requireRegiment, async (req,res)=>{ const b=req.body; await pool.query("UPDATE announcements SET active=false WHERE regiment_id=$1",[req.regiment.id]); const r=await pool.query("INSERT INTO announcements (community_id,regiment_id,message,officer,active) VALUES ($1,$2,$3,$4,true) RETURNING *",[req.community.id,req.regiment.id,b.message,b.officer||"Regiment Command"]); res.json(r.rows[0]); });

app.listen(PORT, "0.0.0.0", () => console.log(`🚀 RoleplayCore backend running on ${PORT}`));
