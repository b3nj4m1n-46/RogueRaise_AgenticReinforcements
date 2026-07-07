import { redirect } from "next/navigation";

// The public entry route mirrors the eventual first-party path `/rogue-raise`
// (PRD §3.1).
export default function Home() {
  redirect("/rogue-raise");
}
