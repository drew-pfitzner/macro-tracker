import { useState, useEffect } from "react";

const CAL_TARGET = 2100;
const PRO_TARGET = 150;
const LOG_KEY = "fg-log";
const SAVED_KEY = "fg-saved";
const APIKEY_KEY = "fg-gemini-key";

async function parseWithGemini(input, apiKey) {
  const prompt = `You are a nutrition estimator. The user will describe food they ate.
Respond with ONLY a raw JSON object, no markdown, no backticks, no explanation.
Format: {"meal":"Breakfast","item":"clean item name","cal":number,"pro":number}
meal must be one of: Breakfast, Lunch, Dinner, Snack, Drink, Treat
cal = calories as integer, pro = grams of protein as integer.
Food: ${input}`;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 200 },
      }),
    }
  );

  if (!res.ok) {
    const err = await res.json();
    throw new Error(err?.error?.message || `API error ${res.status}`);
  }

  const data = await res.json();
  const raw = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`Unexpected response: ${raw.slice(0, 80)}`);
  const parsed = JSON.parse(match[0]);
  if (!parsed.item || typeof parsed.cal !== "number" || typeof parsed.pro !== "number") {
    throw new Error(`Bad response shape`);
  }
  if (!["Breakfast","Lunch","Dinner","Snack","Drink","Treat"].includes(parsed.meal)) {
    parsed.meal = "Snack";
  }
  return parsed;
}

function Gauge({ label, value, target, color, unit }) {
  const pct = Math.min((value / target) * 100, 100);
  const over = value > target;
  const segments = 20;
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
        <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 11, letterSpacing: 3, textTransform: "uppercase", color: "#888" }}>{label}</span>
        <span style={{ fontFamily: "'DM Mono', monospace" }}>
          <span style={{ fontSize: 20, color: over ? "#ff6b6b" : color, fontWeight: 700 }}>{Math.round(value)}</span>
          <span style={{ fontSize: 13, color: "#555" }}> / {target}{unit}</span>
        </span>
      </div>
      <div style={{ display: "flex", gap: 3 }}>
        {Array.from({ length: segments }).map((_, i) => (
          <div key={i} style={{
            flex: 1, height: 10, borderRadius: 3,
            background: (i / segments) * 100 < pct ? (over ? "#ff6b6b" : color) : "#1e1e1e",
            border: `1px solid ${(i / segments) * 100 < pct ? "transparent" : "#2a2a2a"}`,
            transition: `background 0.3s ease ${i * 15}ms`,
            boxShadow: (i / segments) * 100 < pct ? `0 0 6px ${color}55` : "none",
          }} />
        ))}
      </div>
      <div style={{ marginTop: 5, fontFamily: "'DM Mono', monospace", fontSize: 11, color: "#555" }}>
        {over ? `⚠ ${Math.round(value - target)}${unit} over` : `${Math.round(target - value)}${unit} remaining`}
      </div>
    </div>
  );
}

const TAB = { LOG: "log", SAVED: "saved", SETTINGS: "settings" };
const mealColors = { Breakfast: "#f4a261", Lunch: "#52b788", Dinner: "#4cc9f0", Snack: "#c77dff", Drink: "#90e0ef", Treat: "#f72585" };

function useStorage(key, fallback) {
  const [val, setVal] = useState(fallback);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    window.storage.get(key).then(r => {
      if (r?.value) setVal(JSON.parse(r.value));
    }).catch(() => {}).finally(() => setReady(true));
  }, [key]);
  useEffect(() => {
    if (!ready) return;
    window.storage.set(key, JSON.stringify(val)).catch(() => {});
  }, [val, ready, key]);
  return [val, setVal, ready];
}

export default function FuelGauge() {
  const [log, setLog, logReady] = useStorage(LOG_KEY, []);
  const [saved, setSaved] = useStorage(SAVED_KEY, []);
  const [apiKey, setApiKey] = useStorage(APIKEY_KEY, "");
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [tab, setTab] = useState(TAB.LOG);
  const [confirmReset, setConfirmReset] = useState(false);
  const [keyInput, setKeyInput] = useState("");
  const [keyVisible, setKeyVisible] = useState(false);
  const [saveNext, setSaveNext] = useState(false);

  const totalCal = log.reduce((s, e) => s + e.cal, 0);
  const totalPro = log.reduce((s, e) => s + e.pro, 0);

  async function handleAdd(prefill) {
    const text = prefill || input;
    if (!text.trim()) return;
    if (!apiKey) { setError("Add your Gemini API key in Settings first."); setTab(TAB.SETTINGS); return; }
    setLoading(true);
    setError("");
    try {
      const entry = await parseWithGemini(text, apiKey);
      const withId = { ...entry, id: Date.now() };
      setLog(prev => [...prev, withId]);
      if (saveNext) {
        setSaved(prev => [...prev, { ...entry, id: Date.now() + 1 }]);
        setSaveNext(false);
      }
      setInput("");
    } catch (e) {
      setError(e.message);
    }
    setLoading(false);
  }

  function addFromSaved(item) {
    setLog(prev => [...prev, { ...item, id: Date.now() }]);
  }

  function deleteSaved(id) {
    setSaved(prev => prev.filter(e => e.id !== id));
  }

  function handleReset() {
    if (!confirmReset) { setConfirmReset(true); setTimeout(() => setConfirmReset(false), 3000); return; }
    setLog([]); setConfirmReset(false);
  }

  function saveKey() {
    setApiKey(keyInput.trim());
    setKeyInput("");
    setError("");
  }

  const btn = (active, label, t) => (
    <button onClick={() => setTab(t)} style={{
      background: tab === t ? "#1e1e1e" : "none",
      border: `1px solid ${tab === t ? "#333" : "transparent"}`,
      borderRadius: 8, padding: "7px 14px",
      color: tab === t ? "#eee" : "#555", fontSize: 11,
      fontFamily: "'DM Mono', monospace", letterSpacing: 1,
      cursor: "pointer", transition: "all 0.2s",
    }}>{label}</button>
  );

  return (
    <div style={{ minHeight: "100vh", background: "#0a0a0a", display: "flex", justifyContent: "center", alignItems: "flex-start", padding: "36px 16px", fontFamily: "'DM Sans', sans-serif" }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=DM+Sans:wght@300;400;500&display=swap" rel="stylesheet" />
      <div style={{ width: "100%", maxWidth: 480 }}>

        {/* Header */}
        <div style={{ marginBottom: 28, display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
          <div>
            <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, letterSpacing: 4, color: "#444", marginBottom: 5 }}>DINNER → DINNER CYCLE</div>
            <h1 style={{ margin: 0, fontSize: 26, fontWeight: 300, color: "#eee", letterSpacing: -0.5 }}>
              Fuel <span style={{ color: "#4cc9f0", fontWeight: 500 }}>Gauge</span>
            </h1>
          </div>
          <button onClick={handleReset} style={{
            background: confirmReset ? "#ff6b6b22" : "none",
            border: `1px solid ${confirmReset ? "#ff6b6b" : "#2a2a2a"}`,
            borderRadius: 8, padding: "7px 13px",
            color: confirmReset ? "#ff6b6b" : "#444",
            fontSize: 11, fontFamily: "'DM Mono', monospace", letterSpacing: 1, cursor: "pointer", transition: "all 0.2s",
          }}>{confirmReset ? "CONFIRM?" : "NEW CYCLE"}</button>
        </div>

        {/* Gauges */}
        <div style={{ background: "#111", borderRadius: 16, padding: "22px 22px 14px", marginBottom: 14, border: "1px solid #1e1e1e" }}>
          <Gauge label="Calories" value={totalCal} target={CAL_TARGET} color="#f4a261" unit=" kcal" />
          <Gauge label="Protein" value={totalPro} target={PRO_TARGET} color="#52b788" unit="g" />
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
          {btn(tab === TAB.LOG, "LOG", TAB.LOG)}
          {btn(tab === TAB.SAVED, "SAVED FOODS", TAB.SAVED)}
          {btn(tab === TAB.SETTINGS, "SETTINGS", TAB.SETTINGS)}
        </div>

        {/* LOG TAB */}
        {tab === TAB.LOG && (
          <div style={{ background: "#111", borderRadius: 16, padding: 20, border: "1px solid #1e1e1e" }}>
            <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, letterSpacing: 3, color: "#555", marginBottom: 10 }}>ADD FOOD</div>
            <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
              <input
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleAdd()}
                placeholder="e.g. WPC 2 scoops, 14g honey"
                style={{
                  flex: 1, background: "#181818", border: "1px solid #2a2a2a",
                  borderRadius: 10, padding: "11px 13px", color: "#eee",
                  fontSize: 14, outline: "none", fontFamily: "'DM Sans', sans-serif",
                }}
              />
              <button onClick={() => handleAdd()} disabled={loading} style={{
                background: loading ? "#1e1e1e" : "#4cc9f0", border: "none",
                borderRadius: 10, padding: "11px 16px",
                color: loading ? "#555" : "#000", fontWeight: 600, fontSize: 14,
                cursor: loading ? "default" : "pointer", transition: "all 0.2s", whiteSpace: "nowrap",
              }}>{loading ? "..." : "+ Add"}</button>
            </div>

            {/* Save toggle */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <div onClick={() => setSaveNext(p => !p)} style={{
                width: 32, height: 18, borderRadius: 9,
                background: saveNext ? "#52b788" : "#1e1e1e",
                border: `1px solid ${saveNext ? "#52b788" : "#333"}`,
                cursor: "pointer", position: "relative", transition: "all 0.2s",
              }}>
                <div style={{
                  position: "absolute", top: 2, left: saveNext ? 14 : 2,
                  width: 12, height: 12, borderRadius: "50%",
                  background: saveNext ? "#fff" : "#555", transition: "left 0.2s",
                }} />
              </div>
              <span style={{ fontSize: 11, fontFamily: "'DM Mono', monospace", color: saveNext ? "#52b788" : "#555", letterSpacing: 1 }}>
                SAVE TO LIBRARY
              </span>
            </div>

            {error && <div style={{ marginBottom: 10, fontSize: 11, color: "#ff6b6b", fontFamily: "'DM Mono', monospace", wordBreak: "break-all", lineHeight: 1.5 }}>⚠ {error}</div>}

            {/* Log entries */}
            <div style={{ borderTop: "1px solid #1a1a1a", paddingTop: 12 }}>
              <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, letterSpacing: 3, color: "#444", marginBottom: 10 }}>TODAY'S LOG</div>
              {log.length === 0 && (
                <div style={{ color: "#333", fontSize: 12, textAlign: "center", padding: "16px 0", fontFamily: "'DM Mono', monospace" }}>
                  {logReady ? "— nothing logged yet —" : "loading..."}
                </div>
              )}
              {log.map(entry => (
                <div key={entry.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 0", borderBottom: "1px solid #181818" }}>
                  <div style={{ width: 3, height: 32, borderRadius: 2, background: mealColors[entry.meal] || "#555", flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, color: "#ddd", fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{entry.item}</div>
                    <div style={{ fontSize: 11, color: "#555", fontFamily: "'DM Mono', monospace", marginTop: 1 }}>
                      <span style={{ color: mealColors[entry.meal] || "#555" }}>{entry.meal}</span>
                      {" · "}{entry.cal} kcal · {entry.pro}g protein
                    </div>
                  </div>
                  <button onClick={() => setLog(prev => prev.filter(e => e.id !== entry.id))} style={{
                    background: "none", border: "none", color: "#333", cursor: "pointer",
                    fontSize: 16, padding: "4px 8px", borderRadius: 6, transition: "color 0.2s",
                  }}
                    onMouseEnter={e => e.target.style.color = "#ff6b6b"}
                    onMouseLeave={e => e.target.style.color = "#333"}
                  >×</button>
                </div>
              ))}
              {log.length > 0 && (
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 16, paddingTop: 10, fontFamily: "'DM Mono', monospace", fontSize: 11, color: "#555" }}>
                  <span><span style={{ color: "#f4a261" }}>{totalCal}</span> kcal</span>
                  <span><span style={{ color: "#52b788" }}>{totalPro}g</span> protein</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* SAVED FOODS TAB */}
        {tab === TAB.SAVED && (
          <div style={{ background: "#111", borderRadius: 16, padding: 20, border: "1px solid #1e1e1e" }}>
            <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, letterSpacing: 3, color: "#555", marginBottom: 14 }}>SAVED FOODS</div>
            {saved.length === 0 && (
              <div style={{ color: "#333", fontSize: 12, textAlign: "center", padding: "20px 0", fontFamily: "'DM Mono', monospace", lineHeight: 1.8 }}>
                — no saved foods yet —<br />
                <span style={{ color: "#2a2a2a" }}>toggle "save to library" when logging</span>
              </div>
            )}
            {saved.map(entry => (
              <div key={entry.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 0", borderBottom: "1px solid #181818" }}>
                <div style={{ width: 3, height: 32, borderRadius: 2, background: mealColors[entry.meal] || "#555", flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, color: "#ddd", fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{entry.item}</div>
                  <div style={{ fontSize: 11, color: "#555", fontFamily: "'DM Mono', monospace", marginTop: 1 }}>
                    {entry.cal} kcal · {entry.pro}g protein
                  </div>
                </div>
                <button onClick={() => addFromSaved(entry)} style={{
                  background: "#4cc9f022", border: "1px solid #4cc9f044",
                  borderRadius: 7, padding: "5px 10px", color: "#4cc9f0",
                  fontSize: 11, fontFamily: "'DM Mono', monospace", cursor: "pointer", transition: "all 0.2s",
                }}>+ LOG</button>
                <button onClick={() => deleteSaved(entry.id)} style={{
                  background: "none", border: "none", color: "#333", cursor: "pointer",
                  fontSize: 16, padding: "4px 6px", borderRadius: 6, transition: "color 0.2s",
                }}
                  onMouseEnter={e => e.target.style.color = "#ff6b6b"}
                  onMouseLeave={e => e.target.style.color = "#333"}
                >×</button>
              </div>
            ))}
          </div>
        )}

        {/* SETTINGS TAB */}
        {tab === TAB.SETTINGS && (
          <div style={{ background: "#111", borderRadius: 16, padding: 20, border: "1px solid #1e1e1e" }}>
            <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, letterSpacing: 3, color: "#555", marginBottom: 16 }}>SETTINGS</div>

            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 12, fontFamily: "'DM Mono', monospace", color: "#888", marginBottom: 8, letterSpacing: 1 }}>GEMINI API KEY</div>
              {apiKey ? (
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ flex: 1, background: "#181818", border: "1px solid #2a2a2a", borderRadius: 10, padding: "10px 13px", fontSize: 13, color: "#52b788", fontFamily: "'DM Mono', monospace" }}>
                    ✓ Key saved
                  </div>
                  <button onClick={() => setApiKey("")} style={{
                    background: "none", border: "1px solid #2a2a2a", borderRadius: 10,
                    padding: "10px 14px", color: "#555", fontSize: 11,
                    fontFamily: "'DM Mono', monospace", cursor: "pointer",
                  }}>Remove</button>
                </div>
              ) : (
                <>
                  <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                    <input
                      type={keyVisible ? "text" : "password"}
                      value={keyInput}
                      onChange={e => setKeyInput(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && saveKey()}
                      placeholder="AIza..."
                      style={{
                        flex: 1, background: "#181818", border: "1px solid #2a2a2a",
                        borderRadius: 10, padding: "11px 13px", color: "#eee",
                        fontSize: 13, outline: "none", fontFamily: "'DM Mono', monospace",
                      }}
                    />
                    <button onClick={() => setKeyVisible(p => !p)} style={{
                      background: "none", border: "1px solid #2a2a2a", borderRadius: 10,
                      padding: "11px 13px", color: "#555", cursor: "pointer", fontSize: 13,
                    }}>{keyVisible ? "🙈" : "👁"}</button>
                    <button onClick={saveKey} disabled={!keyInput.trim()} style={{
                      background: keyInput.trim() ? "#4cc9f0" : "#1e1e1e", border: "none",
                      borderRadius: 10, padding: "11px 16px",
                      color: keyInput.trim() ? "#000" : "#555", fontWeight: 600,
                      fontSize: 13, cursor: keyInput.trim() ? "pointer" : "default", transition: "all 0.2s",
                    }}>Save</button>
                  </div>
                  <div style={{ fontSize: 11, color: "#444", fontFamily: "'DM Mono', monospace", lineHeight: 1.7 }}>
                    Get a free key at aistudio.google.com → Get API key<br />
                    Stored locally in your browser only.
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        <div style={{ marginTop: 14, textAlign: "center", fontFamily: "'DM Mono', monospace", fontSize: 10, color: "#1e1e1e", letterSpacing: 2 }}>
          DATA PERSISTS · TAP NEW CYCLE TO RESET
        </div>
      </div>
    </div>
  );
}
