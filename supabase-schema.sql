-- ============================================================
-- Portfolio CMS schema for Supabase  (v2 - matches your site's data shape)
-- Run ONCE: Supabase Dashboard > SQL Editor > New query > paste > Run
-- ============================================================
create extension if not exists "pgcrypto";

create or replace function public.set_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at = now(); return new; end $$;

-- ---------- admin allow-list ----------
create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admin_users where user_id = auth.uid());
$$;

-- ---------- projects ----------
-- `num` is the numeric id your site code already expects.
-- home_* columns are OPTIONAL overrides for the homepage card, because your
-- homepage and /pages/projects show slightly different copy/images today.
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  num bigint generated always as identity unique,
  title text not null,
  slug text unique,
  category text not null default 'web',          -- web | video | ai | design
  featured boolean not null default false,
  published boolean not null default true,
  status text not null default '',
  date_label text not null default '',
  description text not null default '',
  details text not null default '',
  highlights text[] not null default '{}',
  tags text[] not null default '{}',
  image_url text,
  live_url text,
  github_url text,
  mobile_url text,
  home_description text,
  home_image_url text,
  home_date text,
  home_tags text[] not null default '{}',
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- posts (the "Latest Updates" timeline) ----------
create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  slug text unique,
  icon text not null default '📝',
  type text not null default 'project',          -- launch | achievement | learning | project
  excerpt text not null default '',              -- shown as the timeline text
  content text not null default '',              -- optional long form
  cover_url text,
  tags text[] not null default '{}',
  published boolean not null default false,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- skills ----------
create table if not exists public.skills (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  level int not null default 50 check (level between 0 and 100),
  icon text not null default '',                 -- emoji; empty keeps the existing icon on the page
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- contact messages ----------
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  email text not null check (char_length(email) between 3 and 200),
  subject text not null default '' check (char_length(subject) <= 200),
  message text not null check (char_length(message) between 1 and 5000),
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists posts_pub_idx on public.posts (published, published_at desc);
create index if not exists projects_sort_idx on public.projects (sort_order);
create index if not exists messages_created_idx on public.messages (created_at desc);

drop trigger if exists trg_projects_updated on public.projects;
drop trigger if exists trg_posts_updated on public.posts;
drop trigger if exists trg_skills_updated on public.skills;
create trigger trg_projects_updated before update on public.projects for each row execute function public.set_updated_at();
create trigger trg_posts_updated    before update on public.posts    for each row execute function public.set_updated_at();
create trigger trg_skills_updated   before update on public.skills   for each row execute function public.set_updated_at();

-- ============================================================
-- Row Level Security
--   visitors: read published content, send contact messages (cannot read them)
--   admin:    full access
-- ============================================================
alter table public.admin_users enable row level security;
alter table public.projects    enable row level security;
alter table public.posts       enable row level security;
alter table public.skills      enable row level security;
alter table public.messages    enable row level security;

drop policy if exists "admin_users: self read" on public.admin_users;
create policy "admin_users: self read" on public.admin_users for select to authenticated using (user_id = auth.uid());

drop policy if exists "projects: public read" on public.projects;
create policy "projects: public read" on public.projects for select to anon, authenticated using (published or public.is_admin());
drop policy if exists "projects: admin write" on public.projects;
create policy "projects: admin write" on public.projects for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "posts: public read" on public.posts;
create policy "posts: public read" on public.posts for select to anon, authenticated
  using ((published and published_at <= now()) or public.is_admin());
drop policy if exists "posts: admin write" on public.posts;
create policy "posts: admin write" on public.posts for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "skills: public read" on public.skills;
create policy "skills: public read" on public.skills for select to anon, authenticated using (true);
drop policy if exists "skills: admin write" on public.skills;
create policy "skills: admin write" on public.skills for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "messages: anyone can send" on public.messages;
create policy "messages: anyone can send" on public.messages for insert to anon, authenticated with check (is_read = false);
create policy "messages: admin read"   on public.messages for select to authenticated using (public.is_admin());
drop policy if exists "messages: admin update" on public.messages;
create policy "messages: admin update" on public.messages for update to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "messages: admin delete" on public.messages;
create policy "messages: admin delete" on public.messages for delete to authenticated using (public.is_admin());

-- realtime inbox
do $$ begin
  alter publication supabase_realtime add table public.messages;
exception when duplicate_object then null; end $$;

-- ===== Seed: projects (from projects.html + homepage overrides) =====
insert into public.projects
 (num,title,slug,category,featured,status,date_label,description,details,highlights,tags,image_url,live_url,github_url,mobile_url,home_description,home_image_url,home_date,home_tags,sort_order) overriding system value values
 (1,'Trip AI','trip-ai','ai',false,'Idea and prototype phase','Idea & Prototype','Trip AI is an early-stage travel planning concept. The project is currently in the idea and prototype phase, with the core experience being explored and shaped.','Trip AI is being explored as an AI-assisted travel companion. The current focus is validating the idea, shaping the user journey, and developing an initial prototype before expanding the feature set.',array['Early product concept','Prototype exploration','Travel-planning experience under development']::text[],array['AI','Travel','Prototype']::text[],'https://images.unsplash.com/photo-1488646953014-85cb44e25828?w=1200&q=85',null,null,null,'An AI travel project in its idea and prototype phase.','https://images.unsplash.com/photo-1488646953014-85cb44e25828?w=600&q=80','Idea · Prototype',array['AI','Travel','Prototype']::text[],6),
 (2,'Lunaflow','lunaflow','web',true,'App completed · Business development ongoing','App Completed · Business Development','Lunaflow is a cross-platform app project. The app build is complete, and the focus has moved to business development and growing its reach.','Lunaflow has both a web experience and a mobile app build. The product development milestone is complete; current work is focused on business development and taking the product forward.',array['Mobile app build completed','Web app available','Business development ongoing']::text[],array['Mobile App','Web App','Product']::text[],'/assets/lunaflow.png','https://lunaflow-sjcodes.lovable.app/',null,'https://drive.google.com/file/d/1RHbr1VQP2OZ7bnGNIzfhQYTL7jqXIlfv/view?usp=drive_link','An application project that has reached completion, with ongoing business development and product growth.','https://images.unsplash.com/photo-1551650975-87deedd944c3?w=600&q=80','App Complete · Business Development',array['Application','Product Development','Business']::text[],2),
 (3,'ShadowOps','shadowops','ai',true,'Core completed · Modification stage','Core Completed · Iterating','ShadowOps is a cybersecurity operations platform concept focused on helping teams inspect security posture, understand findings, and work through remediation workflows. Its core is completed and being refined.','ShadowOps is being developed as an AI-assisted cybersecurity operations platform. The current project milestone is that the core experience is complete; ongoing work is focused on modifications, refinement, and improving the platform.',array['Core platform experience completed','Security findings and remediation workflow direction','Currently in refinement and modification']::text[],array['Cybersecurity','AI','Security Operations']::text[],'/assets/ShadowOps Cybersecurity Operations Hub.png','https://shadow-ops-v1.vercel.app/',null,null,'A cybersecurity operations platform focused on security assessments, evidence-backed findings, attack paths, and guided remediation. Core implementation is complete and currently being refined.','https://images.unsplash.com/photo-1550751827-4bd374c3f58b?w=600&q=80','Core Complete · Refinement',array['Cybersecurity','AI','Security Operations']::text[],1),
 (4,'Ethics Learn AI Hub','ethics-learn-ai-hub','ai',false,'Development phase · Active work','In Development','Ethics Learn AI Hub is an educational AI project currently in active development, with work underway on its learning experience and platform capabilities.','Ethics Learn AI Hub is part of the Ethics Learn ecosystem. The project is currently in its development phase, with implementation and improvements continuing. More public product details will be added as features are finalized.',array['Active development','Education-focused project','Features being built and refined']::text[],array['EdTech','AI','Learning']::text[],'https://images.unsplash.com/photo-1509062522246-3755977927d7?w=1200&q=85',null,null,null,'An AI-focused learning hub currently under development.','https://images.unsplash.com/photo-1501504905252-473c47e087f8?w=600&q=80','Development Phase',array['AI','Education','Learning Platform']::text[],5),
 (5,'QuoteForge AI','quoteforge-ai','ai',true,'Development and UI enhancement ongoing','Development · UI Enhancement','QuoteForge AI is an AI-powered quotation tool. The live app is available, while development and user-interface enhancements continue.','QuoteForge AI is being built to streamline quotation creation. The current web app is available to explore. The project remains under active development, with ongoing work on functionality and UI polish.',array['Live web app available','Quotation workflow product','Development and UI improvements ongoing']::text[],array['AI','Web App','Productivity']::text[],'https://images.unsplash.com/photo-1554224155-8d04cb21cd6c?w=1200&q=85','https://sjcodes-quatation.vercel.app/',null,null,'An AI-powered quotation project focused on improving the quotation experience. Development and UI enhancements are ongoing.','https://images.unsplash.com/photo-1454165804606-c3d57bc86b40?w=600&q=80','Development · UI Enhancement',array['AI','Quotations','Web Application']::text[],3),
 (6,'Palm AI','palm-ai','ai',false,'Prototype phase','Prototype','Palm AI is an AI product currently at the prototype stage. The platform is available to preview while the concept and experience continue to evolve.','Palm AI is currently in its prototype phase. The platform link is available for an early look; capabilities and product scope may continue to change as development progresses.',array['Prototype-stage product','Platform preview available','Concept and experience evolving']::text[],array['AI','Prototype','Web Platform']::text[],'/assets/AI-Powered Palmistry with PalmAI.png','https://palmai.ai.studio/',null,null,'An AI project currently at the prototype stage, with further development planned.','https://images.unsplash.com/photo-1677442135703-1787eea5ce01?w=600&q=80','Prototype',array['AI','Prototype','Product Development']::text[],4);
select setval(pg_get_serial_sequence('public.projects','num'), (select max(num) from public.projects));

-- ===== Seed: updates / blog =====
insert into public.posts (title,slug,icon,type,excerpt,published,published_at) values
 ('Launched Ethics Learn v2.0','launched-ethics-learn-v2-0','🚀','launch','Major update to the Ethics Learn platform with new courses, improved UI, and Firebase integration. 500+ students enrolled!',true,'2024-12-15T12:00:00.000Z'),
 ('Reached 500 YouTube Subscribers','reached-500-youtube-subscribers','🏆','achievement','Crossed the 500 subscriber milestone on Ethics Learn YouTube channel. Thank you for the incredible support!',true,'2024-11-28T12:00:00.000Z'),
 ('Started Learning Next.js & TypeScript','started-learning-next-js-typescript','💡','learning','Diving deep into Next.js 14 with App Router and TypeScript. Building a full-stack project to solidify the concepts.',true,'2024-11-10T12:00:00.000Z'),
 ('Completed AI Content Generator Project','completed-ai-content-generator-project','🎬','project','Built a Python-powered AI tool using OpenAI API that generates blog posts and social media content automatically.',true,'2024-10-22T12:00:00.000Z'),
 ('Completed React Advanced Patterns Course','completed-react-advanced-patterns-course','📚','learning','Finished an advanced React course covering custom hooks, context optimization, and performance patterns.',true,'2024-10-05T12:00:00.000Z');

-- ===== Seed: skills =====
insert into public.skills (name,level,icon,sort_order) values
 ('HTML5',95,'',1),
 ('CSS3',90,'',2),
 ('JavaScript',85,'',3),
 ('React',80,'',4),
 ('Python',75,'',5),
 ('Tailwind CSS',60,'',6),
 ('Video Editing',88,'🎬',7),
 ('UI/UX Design',50,'🎨',8),
 ('AI Tools',82,'🤖',9);

-- ============================================================
-- AFTER creating your login (Authentication > Users > Add user),
-- grant yourself admin by running this with YOUR email:
--
--   insert into public.admin_users (user_id)
--   select id from auth.users where email = 'you@example.com';
-- ============================================================
