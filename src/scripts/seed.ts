/**
 * Seed script for WriteSpace.
 *
 * Safety: refuses to run if the users table already has rows.
 * Deterministic: same RNG_SEED → same data.
 *
 * Design note — denormalized counters:
 *   Post `like_count`, `view_count`, `share_count` and user
 *   `total_followers` / `total_following` are set directly to
 *   plausible high values. We insert only a small subset of real
 *   `likes` / `follows` rows so the UI behaves correctly when a
 *   visitor interacts (increment / decrement the counter by 1).
 *
 *   This keeps the dataset inside Neon's 0.5 GB free-tier limit
 *   while still showing a "busy" platform in the UI.
 *
 * Usage:
 *   npm run db:seed
 *   DATABASE_URL="postgresql://..." npm run db:seed
 */

import bcrypt from "bcryptjs";
import { sql } from "drizzle-orm";
import { db, pool } from "../db";
import {
  users,
  posts,
  comments,
  likes,
  commentLikes,
  follows,
  shares,
  type NewUser,
  type NewPost,
  type NewComment,
  type CodeSnippetSchema,
} from "../db/schema";

// ============================================================
// CONFIG
// ============================================================
const NUM_USERS = 200;
const POSTS_PER_USER = 10;
const DEMO_PASSWORD = "Demo@1234";
const BCRYPT_ROUNDS = 12;
const RNG_SEED = 42;
const BATCH_SIZE = 100;

// Denormalized counter ranges (what the UI displays)
const POST_LIKE_MIN = 100;
const POST_LIKE_MAX = 100_000;
const POST_VIEW_MIN = 1_000;
const POST_VIEW_MAX = 500_000;
const USER_FOLLOW_MIN = 1_000;
const USER_FOLLOW_MAX = 100_000;

// Real-row counts (small, keep DB tiny)
const REAL_LIKES_PER_POST_MIN = 15;
const REAL_LIKES_PER_POST_MAX = 20;
const REAL_COMMENTS_PER_POST_MIN = 3;
const REAL_COMMENTS_PER_POST_MAX = 8;
const REAL_FOLLOWS_PER_USER_MIN = 20;
const REAL_FOLLOWS_PER_USER_MAX = 40;

// ============================================================
// SEEDED RNG
// ============================================================
function createRng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}
const rng = createRng(RNG_SEED);
const randInt = (min: number, max: number) =>
  Math.floor(rng() * (max - min + 1)) + min;
const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rng() * arr.length)];

const sample = <T>(arr: readonly T[], n: number): T[] => {
  const copy = [...arr];
  const out: T[] = [];
  for (let i = 0; i < n && copy.length > 0; i++) {
    const idx = Math.floor(rng() * copy.length);
    out.push(copy.splice(idx, 1)[0]);
  }
  return out;
};

// ============================================================
// DATA
// ============================================================
const FIRST_NAMES = [
  "Aarav",
  "Vivaan",
  "Aditya",
  "Vihaan",
  "Arjun",
  "Sai",
  "Ayaan",
  "Krishna",
  "Ishaan",
  "Shaurya",
  "Atharv",
  "Advik",
  "Pranav",
  "Reyansh",
  "Kabir",
  "Saanvi",
  "Aanya",
  "Aadhya",
  "Aaradhya",
  "Ananya",
  "Pari",
  "Anika",
  "Navya",
  "Diya",
  "Avni",
  "Myra",
  "Sara",
  "Ira",
  "Riya",
  "Kiara",
  "Emma",
  "Olivia",
  "Ava",
  "Sophia",
  "Isabella",
  "Mia",
  "Charlotte",
  "Amelia",
  "Harper",
  "Evelyn",
  "Abigail",
  "Emily",
  "Ella",
  "Elizabeth",
  "Liam",
  "Noah",
  "Oliver",
  "Elijah",
  "James",
  "William",
  "Benjamin",
  "Lucas",
  "Henry",
  "Theodore",
  "Jack",
  "Levi",
  "Alexander",
  "Jackson",
];

const LAST_NAMES = [
  "Sharma",
  "Verma",
  "Patel",
  "Kumar",
  "Singh",
  "Reddy",
  "Gupta",
  "Mehta",
  "Nair",
  "Iyer",
  "Joshi",
  "Rao",
  "Das",
  "Bose",
  "Chopra",
  "Kapoor",
  "Malhotra",
  "Sinha",
  "Yadav",
  "Mishra",
  "Pandey",
  "Tiwari",
  "Bhat",
  "Shetty",
  "Hegde",
  "Pillai",
  "Menon",
  "Banerjee",
  "Chatterjee",
  "Mukherjee",
  "Dutta",
  "Sengupta",
  "Agarwal",
  "Bansal",
  "Chawla",
  "Smith",
  "Johnson",
  "Williams",
  "Brown",
  "Jones",
  "Garcia",
  "Miller",
  "Davis",
  "Rodriguez",
  "Martinez",
  "Anderson",
  "Taylor",
  "Thomas",
];

const LOCATIONS = [
  "Mumbai, India",
  "Bangalore, India",
  "Delhi, India",
  "Hyderabad, India",
  "Chennai, India",
  "Pune, India",
  "Kolkata, India",
  "Ahmedabad, India",
  "Jaipur, India",
  "Kochi, India",
  "Indore, India",
  "Chandigarh, India",
  "San Francisco, USA",
  "New York, USA",
  "Seattle, USA",
  "Austin, USA",
  "London, UK",
  "Berlin, Germany",
  "Amsterdam, Netherlands",
  "Paris, France",
  "Singapore",
  "Tokyo, Japan",
  "Sydney, Australia",
  "Toronto, Canada",
  "Dubai, UAE",
  "Bangalore (Remote)",
  "Berlin (Remote)",
  "NYC (Remote)",
];

const HEADLINES = [
  "Full-Stack Developer",
  "Backend Engineer",
  "Frontend Developer",
  "Software Architect",
  "Tech Lead",
  "Engineering Manager",
  "DevOps Engineer",
  "Product Designer",
  "UX Researcher",
  "Technical Writer",
  "Data Engineer",
  "ML Engineer",
  "Cloud Architect",
  "Site Reliability Engineer",
  "Mobile Developer",
  "Platform Engineer",
  "Security Engineer",
  "Founder & CTO",
  "Indie Hacker",
  "Freelance Developer",
  "Student & Learner",
  "Open Source Contributor",
  "Tech Blogger",
  "Startup Advisor",
  "Career Coach",
  "Staff Engineer",
  "Principal Engineer",
  "Developer Advocate",
  "Solutions Architect",
  "Consultant",
];

const BIO_TEMPLATES = [
  "Building things for the web. Coffee-driven development.",
  "Backend engineer. I write about distributed systems and databases.",
  "Frontend enthusiast. Design systems, accessibility, and good typography.",
  "I make software that makes people's lives easier.",
  "Writing about tech, career, and everything in between.",
  "Currently obsessed with TypeScript, Postgres, and clean architecture.",
  "Shipping code and writing essays. Occasionally both at once.",
  "Learning in public. This is my corner of the internet.",
  "Engineer by day, writer by night. Opinions are my own.",
  "10+ years in software. Still googling CSS.",
  "Polyglot programmer. Currently fluent in TypeScript and sarcasm.",
  "Writing technical deep-dives for the curious.",
  "Building developer tools. Occasional blogger.",
  "Trying to make the web a slightly better place.",
  "Systems, coffee, and long walks through codebases.",
  "I break things, then fix them, then write about it.",
];

const TOPICS = [
  "TypeScript",
  "React",
  "Node.js",
  "PostgreSQL",
  "Redis",
  "Docker",
  "Kubernetes",
  "GraphQL",
  "REST APIs",
  "System Design",
  "Distributed Systems",
  "Caching",
  "Database Indexing",
  "Authentication",
  "Authorization",
  "JWTs",
  "OAuth",
  "React Server Components",
  "Next.js",
  "Remix",
  "Tailwind CSS",
  "Vite",
  "Webpack",
  "ESBuild",
  "Unit Testing",
  "Integration Testing",
  "CI/CD",
  "GitHub Actions",
  "AWS",
  "Cloudflare",
  "Vercel",
  "Microservices",
  "Monoliths",
  "Event-Driven Architecture",
  "Message Queues",
  "Observability",
  "Logging",
  "Monitoring",
  "Performance",
  "Web Security",
  "XSS",
  "CSRF",
  "Rate Limiting",
  "Load Balancing",
  "Clean Architecture",
  "Design Patterns",
];

const TITLE_TEMPLATES = [
  "Understanding {topic} in 2026",
  "A Deep Dive into {topic}",
  "Why {topic} Matters for Modern Teams",
  "{n} Lessons From {topic}",
  "The Complete Guide to {topic}",
  "How We Migrated to {topic}",
  "Debugging {topic}: A Practical Walkthrough",
  "{topic}: Common Pitfalls and How to Avoid Them",
  "From Zero to Production With {topic}",
  "What Nobody Tells You About {topic}",
  "{topic} — A Mental Model",
  "The {topic} Checklist I Wish I Had Earlier",
  "Building With {topic}: A Field Report",
  "{topic} in Production: What Actually Broke",
  "Reconsidering {topic}",
  "When {topic} Fails, and What to Do",
  "A Field Guide to {topic}",
  "Why We Rewrote Our {topic} Layer",
  "{topic}: A Retrospective",
  "What Three Years of {topic} Taught Me",
];

const TAGS = [
  "typescript",
  "javascript",
  "node",
  "react",
  "postgres",
  "database",
  "redis",
  "docker",
  "kubernetes",
  "aws",
  "cloud",
  "devops",
  "testing",
  "architecture",
  "performance",
  "security",
  "design",
  "career",
  "tutorial",
  "deep-dive",
  "opinion",
  "guide",
  "rust",
  "go",
  "cpp",
  "java",
  "sql",
  "caching",
  "api",
  "microservices",
];

const COMMENT_TEMPLATES = [
  "Great article, thanks for sharing!",
  "This is exactly what I needed today. Bookmarked.",
  "I disagree with the section on {topic}, but the rest is solid.",
  "Have you tried using {topic} instead? Curious to hear your thoughts.",
  "Saved. Will come back to this when I need it.",
  "The diagrams really help. More of these please.",
  "Any chance you could cover {topic} next?",
  "Interesting take. I've been doing it slightly differently.",
  "This aged well. Still relevant months later.",
  "Subscribed. Keep writing.",
  "The code examples are clean. Appreciated.",
  "Do you have a repo for this?",
  "Thanks for the detailed write-up.",
  "Solid summary. I'd add one thing: {topic}.",
  "Bookmarked. Sharing with my team.",
  "First time here — this is great content.",
  "I've been looking for something like this.",
  "How does this compare to {topic}?",
  "Ran into the same issue last week.",
  "Concise and clear. Nice.",
];

const REPLY_TEMPLATES = [
  "Agreed!",
  "Thanks for reading!",
  "Good point — I'll add that to the post.",
  "Not sure I follow. Can you elaborate?",
  "Ha, that's fair.",
  "Appreciate it.",
  "Yep, exactly.",
  "Different strokes for different folks.",
  "Will do — next one is in the works.",
  "Glad it helped!",
];

// Verified Unsplash photo IDs
const UNSPLASH_IDS = [
  "photo-1499750310159-5b5b4b6f3a4a",
  "photo-1518770660439-4636190af475",
  "photo-1517842645767-c639042777db",
  "photo-1486312338219-ce68d2c6f44d",
  "photo-1498050108023-c5249f4df085",
  "photo-1461749280684-dccba630e2f6",
  "photo-1555066931-4365d14bab8c",
  "photo-1517694712202-14dd9538aa97",
  "photo-1522071820081-009f0129c71c",
  "photo-1519085360753-af0119f7cbe7",
  "photo-1454165804606-c3d57bc86b40",
  "photo-1552664730-d307ca884978",
  "photo-1541746972996-4e0b0f43e02a",
  "photo-1481627834876-b7833e8f5570",
  "photo-1507842217343-583bb7270b66",
  "photo-1512820790803-83ca734da794",
  "photo-1495446815901-a7297e633e8d",
  "photo-1544716278-ca5e3f4abd8c",
  "photo-1506905925346-21bda4d32df4",
  "photo-1441974231531-c6227db76b6e",
  "photo-1470071459604-3b5ec3a7fe05",
  "photo-1447752875215-b2761acb3c5d",
  "photo-1501785888041-af3ef285b470",
  "photo-1519681393784-d120267933ba",
  "photo-1518791841217-8f162f1e1131",
  "photo-1439066615861-d1af74d74000",
  "photo-1472214103451-9374bd1c798e",
  "photo-1500964757637-c85e8a162699",
  "photo-1493246507139-91e8fad9978e",
  "photo-1516035069371-29a1b244cc32",
  "photo-1493421419110-74f4e85ba126",
  "photo-1460925895917-afdab827c52f",
  "photo-1465101046530-73398c7f28ca",
  "photo-1551288049-bebda4e38f71",
  "photo-1555949963-ff9fe0c870eb",
];

// ============================================================
// CODE SNIPPETS
// ============================================================
type Language =
  | "typescript"
  | "javascript"
  | "cpp"
  | "c"
  | "rust"
  | "go"
  | "java"
  | "sql";

const SNIPPETS: Record<Language, string[]> = {
  typescript: [
    `type Result<T, E = Error> = { ok: true; value: T } | { ok: false; error: E };

export async function attempt<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, value: await fn() };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error : new Error(String(error)) };
  }
}`,
    `interface UserRepository {
  findById(id: string): Promise<User | null>;
  save(user: User): Promise<void>;
}

export class UserService {
  constructor(private readonly repo: UserRepository) {}

  async promote(id: string): Promise<User> {
    const user = await this.repo.findById(id);
    if (!user) throw new Error("User not found");
    user.role = "admin";
    await this.repo.save(user);
    return user;
  }
}`,
    `export function debounce<A extends unknown[]>(
  fn: (...args: A) => void,
  delay: number,
): (...args: A) => void {
  let timer: NodeJS.Timeout | undefined;
  return (...args: A) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}`,
  ],
  javascript: [
    `const cache = new Map();

export function memoize(fn) {
  return function (...args) {
    const key = JSON.stringify(args);
    if (cache.has(key)) return cache.get(key);
    const result = fn.apply(this, args);
    cache.set(key, result);
    return result;
  };
}`,
    `async function fetchWithRetry(url, options = {}, attempts = 3) {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, options);
      if (res.ok) return res.json();
    } catch (err) {
      if (i === attempts - 1) throw err;
      await new Promise((r) => setTimeout(r, 2 ** i * 500));
    }
  }
}`,
  ],
  cpp: [
    `#include <vector>
#include <algorithm>

template <typename T>
std::vector<T> quicksort(std::vector<T> arr) {
    if (arr.size() <= 1) return arr;
    T pivot = arr[arr.size() / 2];
    std::vector<T> less, equal, greater;
    for (const auto& x : arr) {
        if (x < pivot) less.push_back(x);
        else if (x > pivot) greater.push_back(x);
        else equal.push_back(x);
    }
    auto l = quicksort(less);
    auto g = quicksort(greater);
    l.insert(l.end(), equal.begin(), equal.end());
    l.insert(l.end(), g.begin(), g.end());
    return l;
}`,
    `#include <memory>
#include <iostream>

class Widget {
public:
    Widget(int id) : id_(id) {}
    int id() const { return id_; }
private:
    int id_;
};

int main() {
    auto w = std::make_unique<Widget>(42);
    std::cout << w->id() << "\\n";
    return 0;
}`,
  ],
  c: [
    `#include <stdlib.h>
#include <string.h>

char *str_dup(const char *s) {
    size_t len = strlen(s) + 1;
    char *copy = malloc(len);
    if (copy) memcpy(copy, s, len);
    return copy;
}

int main(void) {
    char *s = str_dup("hello");
    free(s);
    return 0;
}`,
    `#include <stdio.h>

int binary_search(const int *arr, int n, int target) {
    int lo = 0, hi = n - 1;
    while (lo <= hi) {
        int mid = lo + (hi - lo) / 2;
        if (arr[mid] == target) return mid;
        if (arr[mid] < target) lo = mid + 1;
        else hi = mid - 1;
    }
    return -1;
}`,
  ],
  rust: [
    `use std::collections::HashMap;

pub fn word_count(text: &str) -> HashMap<&str, usize> {
    let mut counts = HashMap::new();
    for word in text.split_whitespace() {
        *counts.entry(word).or_insert(0) += 1;
    }
    counts
}`,
    `#[derive(Debug, Clone)]
pub struct User {
    pub id: u64,
    pub name: String,
}

impl User {
    pub fn new(id: u64, name: impl Into<String>) -> Self {
        Self { id, name: name.into() }
    }
}

pub fn find_by_id<'a>(users: &'a [User], id: u64) -> Option<&'a User> {
    users.iter().find(|u| u.id == id)
}`,
  ],
  go: [
    `package main

import (
	"errors"
	"fmt"
)

type Stack[T any] struct {
	items []T
}

func (s *Stack[T]) Push(v T) { s.items = append(s.items, v) }

func (s *Stack[T]) Pop() (T, error) {
	var zero T
	if len(s.items) == 0 {
		return zero, errors.New("stack empty")
	}
	v := s.items[len(s.items)-1]
	s.items = s.items[:len(s.items)-1]
	return v, nil
}

func main() {
	s := &Stack[int]{}
	s.Push(1)
	v, _ := s.Pop()
	fmt.Println(v)
}`,
  ],
  java: [
    `import java.util.List;
import java.util.stream.Collectors;

public record User(long id, String name) {}

public class UserService {
    public List<String> namesAboveId(List<User> users, long threshold) {
        return users.stream()
            .filter(u -> u.id() > threshold)
            .map(User::name)
            .collect(Collectors.toList());
    }
}`,
  ],
  sql: [
    `-- Find the top 10 authors by total likes on their published posts
SELECT
    u.id,
    u.username,
    u.fullname,
    COUNT(l.user_id) AS total_likes
FROM users u
JOIN posts p ON p.author_id = u.id
LEFT JOIN likes l ON l.post_id = p.id
WHERE p.status = 'published'
GROUP BY u.id, u.username, u.fullname
ORDER BY total_likes DESC
LIMIT 10;`,
    `-- Composite index for feed queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS posts_feed_idx
ON posts (status, publish_date DESC)
WHERE status = 'published';

-- Covering index for lookups by slug
CREATE INDEX posts_slug_idx ON posts (slug) INCLUDE (id, title);`,
  ],
};

const CODE_LANGUAGES: Language[] = [
  "typescript",
  "typescript",
  "typescript",
  "javascript",
  "cpp",
  "c",
  "rust",
  "go",
  "java",
  "sql",
];

// ============================================================
// HELPERS
// ============================================================
function buildSlug(title: string, index: number): string {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 60);
  return `${base}-${index.toString(36)}`;
}

const PARAGRAPH_OPENERS = [
  "The first time I encountered this, I made every mistake in the book.",
  "There's a version of this that works and a version that scales — they're rarely the same.",
  "Let me start with the problem, because the solution only makes sense in context.",
  "I've been avoiding writing about this because it's easy to get wrong.",
  "Three years ago I would have written this post very differently.",
  "This is one of those topics where the docs tell you what to do but not why.",
  "The team pushed back when I first suggested this. Then they came around.",
  "If you take one thing away from this post, let it be the trade-offs.",
  "I've now used this pattern across four production systems.",
  "This isn't a silver bullet — it's a tool with a narrow range of usefulness.",
];

const PARAGRAPH_BODIES = [
  "The naive approach works fine at small scale. You have one server, one database, a handful of users. Everything is synchronous, everything is simple, and you can hold the whole system in your head. Then the metrics start climbing and suddenly the assumptions you never wrote down start collapsing.",
  "Most engineering decisions are about which constraint you're willing to live with. Speed trades against correctness. Simplicity trades against flexibility. There is no arrangement where you get everything for free, and pretending otherwise just defers the cost to a time when it's harder to pay.",
  "What surprised me was how much of this turned out to be about communication rather than code. The technical part was tractable — a few days of refactoring, a migration plan, a rollback path. The hard part was convincing the team that the current shape of things was worth changing.",
  "The version that ships is always less elegant than the version in your head. That's not failure; that's the process working. Getting something into production teaches you what actually matters, and it's rarely what you worried about during design.",
  "I keep coming back to this idea: complexity is conserved. You can move it around — from code to ops, from runtime to build time, from one service to another — but you cannot eliminate it. The question is always which form of complexity you're best equipped to handle.",
  "There's a class of bugs that only appears under load, and they're the most expensive kind. Your code is technically correct. Your tests pass. But the interaction between two components at concurrency ten thousand produces a failure mode that no amount of local reasoning predicts.",
  "The instinct to add another layer of abstraction when things get complicated is understandable but usually wrong. Abstractions have their own complexity budget, and past a certain point you're paying more for the indirection than you were for the direct approach.",
  "Documentation matters more than most engineers admit. Not because other people read it — though they do — but because writing it forces you to confront whether you actually understand the thing you built. Half the bugs I've fixed came from explaining the code well enough to notice it was wrong.",
  "If there's a theme running through this, it's that production rewards boring. Exciting architectures, clever type-level tricks, novel patterns — they're fun to write and miserable to maintain. The systems that survive five years are the ones nobody had to think about.",
  "Measurement beats intuition every time. Every performance problem I've chased had an obvious cause that turned out to be wrong once I actually looked at the numbers. The profiler is unemotional. Trust it over your gut.",
];

function buildParagraph(topic: string): string {
  const opener = pick(PARAGRAPH_OPENERS);
  const body = pick(PARAGRAPH_BODIES);
  const bridge = `This is why ${topic} keeps coming up in these discussions.`;
  return `${opener} ${body} ${bridge}`;
}

function buildContent(topic: string): string {
  const paraCount = randInt(5, 9);
  const paragraphs: string[] = [];
  for (let i = 0; i < paraCount; i++) {
    paragraphs.push(`<p>${buildParagraph(topic)}</p>`);
  }
  return paragraphs.join("\n");
}

function buildCodeSnippets(): CodeSnippetSchema[] {
  const count = randInt(1, 2);
  const snippets: CodeSnippetSchema[] = [];
  for (let i = 0; i < count; i++) {
    const lang = pick(CODE_LANGUAGES);
    const code = pick(SNIPPETS[lang]);
    snippets.push({ language: lang, code });
  }
  return snippets;
}

function excerptFrom(content: string): string {
  const text = content
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > 220 ? `${text.slice(0, 220)}...` : text;
}

function unsplashUrl(id: string, w: number, h?: number): string {
  const dims = h ? `w=${w}&h=${h}&fit=crop` : `w=${w}`;
  return `https://images.unsplash.com/${id}?${dims}&q=80`;
}

// ============================================================
// MAIN
// ============================================================
async function main() {
  console.log("🌱 Starting seed...\n");

  const existing = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(users);
  if (existing[0].c > 0) {
    throw new Error(
      `Refusing to seed: users table already has ${existing[0].c} rows. ` +
        `Truncate first if you want to reseed.`,
    );
  }

  // 1. Password hash (once)
  console.log("🔐 Hashing demo password...");
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, BCRYPT_ROUNDS);

  // 2. Users
  console.log(`👥 Generating ${NUM_USERS} users...`);
  const userRows: NewUser[] = [];
  const usedUsernames = new Set<string>();
  for (let i = 0; i < NUM_USERS; i++) {
    const first = pick(FIRST_NAMES);
    const last = pick(LAST_NAMES);
    let username = `${first.toLowerCase()}${last.toLowerCase().slice(0, 4)}`;
    while (usedUsernames.has(username)) {
      username = `${first.toLowerCase()}${last.toLowerCase().slice(0, 4)}${randInt(1, 999)}`;
    }
    usedUsernames.add(username);

    userRows.push({
      fullname: `${first} ${last}`,
      email: `${username}@writespace.dev`,
      username,
      passwordHash,
      bio: pick(BIO_TEMPLATES),
      headline: pick(HEADLINES),
      location: pick(LOCATIONS),
      profileImageUrl: `https://api.dicebear.com/7.x/adventurer/svg?seed=${username}`,
      bannerImageUrl: unsplashUrl(pick(UNSPLASH_IDS), 1500),
      github: `https://github.com/${username}`,
      twitter: `https://twitter.com/${username}`,
      linkedin: `https://linkedin.com/in/${username}`,
      website: `https://${username}.dev`,
      // Denormalized follower counters — set to plausible high values
      totalFollowers: randInt(USER_FOLLOW_MIN, USER_FOLLOW_MAX),
      totalFollowing: randInt(USER_FOLLOW_MIN, USER_FOLLOW_MAX),
    });
  }

  const insertedUsers: { id: string; username: string }[] = [];
  for (let i = 0; i < userRows.length; i += BATCH_SIZE) {
    const rows = await db
      .insert(users)
      .values(userRows.slice(i, i + BATCH_SIZE))
      .returning({ id: users.id, username: users.username });
    insertedUsers.push(...rows);
  }
  console.log(`   ✅ Inserted ${insertedUsers.length} users\n`);

  // 3. Posts
  const totalPosts = NUM_USERS * POSTS_PER_USER;
  console.log(
    `📝 Generating ${totalPosts} posts (with code snippets + images)...`,
  );
  const postRows: NewPost[] = [];
  let postIdx = 0;

  for (const u of insertedUsers) {
    for (let i = 0; i < POSTS_PER_USER; i++) {
      const topic = pick(TOPICS);
      const title = pick(TITLE_TEMPLATES)
        .replace("{topic}", topic)
        .replace("{n}", String(randInt(3, 12)));

      const daysAgo = randInt(1, 730);
      const publishDate = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
      const content = buildContent(topic);
      const hasCode = rng() < 0.4;
      const hasMedia = rng() < 0.3;
      const mediaCount = hasMedia ? randInt(1, 3) : 0;

      postRows.push({
        title,
        slug: buildSlug(title, postIdx),
        subtitle: `${topic} — a working engineer's perspective.`,
        content,
        excerpt: excerptFrom(content),
        authorId: u.id,
        status: "published",
        publishDate,
        coverImageUrl: unsplashUrl(pick(UNSPLASH_IDS), 1200, 630),
        coverImagePublicId: null,
        coverImageAltText: `Cover image for ${title}`,
        coverImageCredit: "Unsplash",
        media:
          mediaCount > 0
            ? Array.from({ length: mediaCount }, () =>
                unsplashUrl(pick(UNSPLASH_IDS), 1200),
              )
            : [],
        mediaPublicIds: [],
        codeSnippets: hasCode ? buildCodeSnippets() : [],
        tags: sample(TAGS, randInt(2, 5)),
        readTime: randInt(3, 15),
        // Denormalized counters
        likeCount: randInt(POST_LIKE_MIN, POST_LIKE_MAX),
        viewCount: randInt(POST_VIEW_MIN, POST_VIEW_MAX),
        shareCount: randInt(0, 2_000),
        commentCount: 0, // set after comments are inserted
      });
      postIdx++;
    }
  }

  const insertedPosts: { id: string; authorId: string }[] = [];
  for (let i = 0; i < postRows.length; i += BATCH_SIZE) {
    const rows = await db
      .insert(posts)
      .values(postRows.slice(i, i + BATCH_SIZE))
      .returning({ id: posts.id, authorId: posts.authorId });
    insertedPosts.push(...rows);
  }
  console.log(`   ✅ Inserted ${insertedPosts.length} posts\n`);

  // 4. Comments (real, small count per post)
  console.log("💬 Generating comments...");
  const userIds = insertedUsers.map((u) => u.id);
  const topComments: NewComment[] = [];
  for (const p of insertedPosts) {
    const n = randInt(REAL_COMMENTS_PER_POST_MIN, REAL_COMMENTS_PER_POST_MAX);
    for (let i = 0; i < n; i++) {
      const commenter = pick(userIds);
      if (commenter === p.authorId && rng() < 0.5) continue;
      topComments.push({
        content: pick(COMMENT_TEMPLATES)
          .replace("{topic}", pick(TOPICS))
          .slice(0, 1000),
        postId: p.id,
        authorId: commenter,
      });
    }
  }

  const insertedTopComments: { id: string; postId: string }[] = [];
  for (let i = 0; i < topComments.length; i += BATCH_SIZE) {
    const rows = await db
      .insert(comments)
      .values(topComments.slice(i, i + BATCH_SIZE))
      .returning({ id: comments.id, postId: comments.postId });
    insertedTopComments.push(...rows);
  }

  const replies: NewComment[] = [];
  for (const c of insertedTopComments) {
    const n = randInt(0, 3);
    for (let i = 0; i < n; i++) {
      replies.push({
        content: pick(REPLY_TEMPLATES),
        postId: c.postId,
        authorId: pick(userIds),
        parentCommentId: c.id,
      });
    }
  }

  const insertedReplies: { id: string; postId: string }[] = [];
  for (let i = 0; i < replies.length; i += BATCH_SIZE) {
    const rows = await db
      .insert(comments)
      .values(replies.slice(i, i + BATCH_SIZE))
      .returning({ id: comments.id, postId: comments.postId });
    insertedReplies.push(...rows);
  }
  console.log(
    `   ✅ Inserted ${insertedTopComments.length} comments + ${insertedReplies.length} replies\n`,
  );

  // 5. Real likes — small subset per post
  console.log("❤️  Generating likes (subset of the counters)...");
  const likeRows: { userId: string; postId: string }[] = [];
  const seenLikes = new Set<string>();
  for (const p of insertedPosts) {
    const n = randInt(REAL_LIKES_PER_POST_MIN, REAL_LIKES_PER_POST_MAX);
    const likers = sample(userIds, Math.min(n, userIds.length));
    for (const uid of likers) {
      const key = `${uid}:${p.id}`;
      if (seenLikes.has(key)) continue;
      seenLikes.add(key);
      likeRows.push({ userId: uid, postId: p.id });
    }
  }
  for (let i = 0; i < likeRows.length; i += BATCH_SIZE) {
    await db.insert(likes).values(likeRows.slice(i, i + BATCH_SIZE));
  }
  console.log(`   ✅ Inserted ${likeRows.length} likes\n`);

  // 6. Comment likes — small subset
  console.log("💗 Generating comment likes...");
  const allCommentIds = [
    ...insertedTopComments.map((c) => c.id),
    ...insertedReplies.map((c) => c.id),
  ];
  const clikeRows: { commentId: string; userId: string }[] = [];
  const seenClikes = new Set<string>();
  for (const cid of allCommentIds) {
    const likers = sample(userIds, randInt(0, 6));
    for (const uid of likers) {
      const key = `${cid}:${uid}`;
      if (seenClikes.has(key)) continue;
      seenClikes.add(key);
      clikeRows.push({ commentId: cid, userId: uid });
    }
  }
  for (let i = 0; i < clikeRows.length; i += BATCH_SIZE) {
    await db.insert(commentLikes).values(clikeRows.slice(i, i + BATCH_SIZE));
  }
  console.log(`   ✅ Inserted ${clikeRows.length} comment likes\n`);

  // 7. Real follows — small subset (counters already set high)
  console.log("🔗 Generating follows (subset of the counters)...");
  const followRows: { followerId: string; followingId: string }[] = [];
  const seenFollows = new Set<string>();
  for (const u of insertedUsers) {
    const n = randInt(REAL_FOLLOWS_PER_USER_MIN, REAL_FOLLOWS_PER_USER_MAX);
    const targets = sample(
      userIds.filter((id) => id !== u.id),
      Math.min(n, userIds.length - 1),
    );
    for (const tid of targets) {
      const key = `${u.id}:${tid}`;
      if (seenFollows.has(key)) continue;
      seenFollows.add(key);
      followRows.push({ followerId: u.id, followingId: tid });
    }
  }
  for (let i = 0; i < followRows.length; i += BATCH_SIZE) {
    await db.insert(follows).values(followRows.slice(i, i + BATCH_SIZE));
  }
  console.log(`   ✅ Inserted ${followRows.length} follows\n`);

  // 8. Shares
  console.log("🔀 Generating shares...");
  const platforms = ["twitter", "facebook", "linkedin", "generic"];
  const shareRows: { userId: string; postId: string; platform: string }[] = [];
  for (const p of insertedPosts) {
    const n = randInt(0, 4);
    for (let i = 0; i < n; i++) {
      shareRows.push({
        userId: pick(userIds),
        postId: p.id,
        platform: pick(platforms),
      });
    }
  }
  for (let i = 0; i < shareRows.length; i += BATCH_SIZE) {
    await db.insert(shares).values(shareRows.slice(i, i + BATCH_SIZE));
  }
  console.log(`   ✅ Inserted ${shareRows.length} shares\n`);

  // 9. Set post.comment_count to the real count (so UI matches data)
  console.log("🔢 Updating post comment counters...");
  await db.execute(sql`
    UPDATE posts SET comment_count = COALESCE(sub.c, 0)
    FROM (
      SELECT post_id, COUNT(*)::int AS c
      FROM comments
      GROUP BY post_id
    ) sub
    WHERE posts.id = sub.post_id
  `);

  // Set user.total_posts to real count (overrides nothing — this is real)
  await db.execute(sql`
    UPDATE users SET total_posts = COALESCE(sub.c, 0)
    FROM (
      SELECT author_id, COUNT(*)::int AS c
      FROM posts
      GROUP BY author_id
    ) sub
    WHERE users.id = sub.author_id
  `);

  // Set comment.like_count and comment.reply_count to real counts
  await db.execute(sql`
    UPDATE comments SET like_count = COALESCE(sub.c, 0)
    FROM (
      SELECT comment_id, COUNT(*)::int AS c
      FROM comment_likes
      GROUP BY comment_id
    ) sub
    WHERE comments.id = sub.comment_id
  `);
  await db.execute(sql`
    UPDATE comments SET reply_count = COALESCE(sub.c, 0)
    FROM (
      SELECT parent_comment_id, COUNT(*)::int AS c
      FROM comments
      WHERE parent_comment_id IS NOT NULL
      GROUP BY parent_comment_id
    ) sub
    WHERE comments.id = sub.parent_comment_id
  `);
  console.log("   ✅ Counters updated\n");

  // Summary
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("✅ Seed complete");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`  Users:                ${insertedUsers.length}`);
  console.log(`  Posts:                ${insertedPosts.length}`);
  console.log(
    `  Comments:             ${insertedTopComments.length + insertedReplies.length}`,
  );
  console.log(`  Real likes:           ${likeRows.length}`);
  console.log(`  Real comment likes:   ${clikeRows.length}`);
  console.log(`  Real follows:         ${followRows.length}`);
  console.log(`  Shares:               ${shareRows.length}`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(
    `\n🔑 Demo login: any seeded email + password "${DEMO_PASSWORD}"`,
  );
  console.log(`   Example: alicepatel@writespace.dev / Demo@1234\n`);
  console.log("📊 Denormalized counters (not backed by individual rows):");
  console.log(`   posts.like_count:      ${POST_LIKE_MIN} – ${POST_LIKE_MAX}`);
  console.log(`   posts.view_count:      ${POST_VIEW_MIN} – ${POST_VIEW_MAX}`);
  console.log(
    `   users.total_followers: ${USER_FOLLOW_MIN} – ${USER_FOLLOW_MAX}`,
  );
  console.log(
    `   users.total_following: ${USER_FOLLOW_MIN} – ${USER_FOLLOW_MAX}\n`,
  );
}

main()
  .then(() => pool.end())
  .catch((err) => {
    console.error("❌ Seed failed:", err);
    pool.end().finally(() => process.exit(1));
  });
