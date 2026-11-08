// Ask the LIVE site for one picture as its owner would (read-only): status, type, size, time.
import { readFileSync } from "node:fs";
import { SignJWT } from "jose";
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
const [user, name] = process.argv.slice(2);
const token = await new SignJWT({ email: `${user}@example.com` }).setProtectedHeader({ alg: "HS256" }).setSubject(user).setIssuedAt().setExpirationTime("10m").sign(new TextEncoder().encode(env.AUTH_SECRET));
console.log(token.length ? "token ok" : "");
process.stdout.write(token);
