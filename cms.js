/* Public data layer: loads projects, updates and skills from Supabase and
   converts them to the exact shapes the existing site code already uses.
   Contains no markup or styling. If Supabase is unreachable, CMS.load()
   resolves false and the site falls back to its built-in defaults. */
(function () {
  const state = { ok: false, projects: [], posts: [], skills: [] };
  let sb = null;
  try {
    if (window.supabase && window.SUPABASE_URL) {
      sb = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
    }
  } catch (e) { console.warn("[CMS] client init failed", e); }

  const fmtDate = iso => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  const nonEmpty = a => Array.isArray(a) && a.length ? a : null;

  async function load(timeoutMs = 5000) {
    if (!sb) return false;
    const work = Promise.all([
      sb.from("projects").select("*").eq("published", true).order("sort_order").order("num"),
      sb.from("posts").select("*").eq("published", true).lte("published_at", new Date().toISOString()).order("published_at", { ascending: false }),
      sb.from("skills").select("*").order("sort_order"),
    ]);
    const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), timeoutMs));
    try {
      const [p, b, s] = await Promise.race([work, timeout]);
      const err = p.error || b.error || s.error;
      if (err) throw err;
      state.projects = p.data; state.posts = b.data; state.skills = s.data; state.ok = true;
    } catch (e) { console.warn("[CMS] using built-in defaults:", e.message || e); state.ok = false; }
    return state.ok;
  }

  // view: "home" applies the optional home_* overrides; "full" is the /pages/projects view.
  function projects(view) {
    if (!state.ok) return null;
    const home = view === "home";
    return state.projects.map(r => ({
      id: Number(r.num),
      title: r.title,
      category: r.category,
      featured: !!r.featured,
      date: (home && r.home_date) || r.date_label || "",
      status: r.status || "",
      desc: (home && r.home_description) || r.description || "",
      details: r.details || "",
      highlights: r.highlights || [],
      tags: (home && nonEmpty(r.home_tags)) || r.tags || [],
      image: (home && r.home_image_url) || r.image_url || "",
      github: r.github_url || "#",
      demo: r.live_url || "#",
      ...(r.mobile_url ? { mobile: r.mobile_url } : {}),
    }));
  }

  function blog() {
    if (!state.ok) return null;
    return state.posts.map(r => ({
      id: r.id,
      icon: r.icon || "📝",
      date: fmtDate(r.published_at),
      type: r.type || "project",
      title: r.title,
      text: r.excerpt || r.content || "",
    }));
  }

  function skills() { return state.ok ? state.skills : null; }

  async function sendMessage({ name, email, subject, message }) {
    if (!sb) throw new Error("Messaging is unavailable right now.");
    const { error } = await sb.from("messages").insert({
      name: String(name).trim(), email: String(email).trim(),
      subject: String(subject || "").trim(), message: String(message).trim(),
    });
    if (error) throw error;
  }

  window.CMS = { load, projects, blog, skills, sendMessage };
})();
