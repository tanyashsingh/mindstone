import type { PropertyType } from "./types";

export interface TemplateDbSpec { name: string; props: [string, PropertyType, string[]?][]; views?: ("board" | "calendar" | "gallery" | "timeline" | "chart")[] }
export interface BuiltInTemplate { id: string; name: string; icon: string; description: string; category: string; markdown: string; database?: TemplateDbSpec }

export const BUILT_IN_TEMPLATES: BuiltInTemplate[] = [
  { id: "personal-dashboard", category: "Personal", name: "Personal dashboard", icon: "🏠", description: "Focus areas, priorities and links in one place.",
    markdown: "> [!TIP]\n> Link your most-used pages here with [[ and keep this page starred.\n\n## This week's focus\n- [ ] \n\n## Areas\n- Health\n- Work\n- Learning\n- Relationships\n\n## Quick links\n" },
  { id: "student", category: "Education", name: "Student dashboard", icon: "🎓", description: "Courses, assignments and exam dates.",
    markdown: "## Semester goals\n- \n\n## Study plan\n- [ ] Review lecture notes daily\n", database: { name: "Assignments", props: [["Assignment", "title"], ["Course", "select"], ["Status", "status"], ["Due", "date"], ["Grade", "number"]], views: ["board", "calendar"] } },
  { id: "project-planner", category: "Work", name: "Project planner", icon: "🗂️", description: "Goals, scope, milestones and a task board.",
    markdown: "## Goal\n\n## Scope\n- In scope:\n- Out of scope:\n\n## Milestones\n- [ ] Kickoff\n- [ ] First draft\n- [ ] Launch\n\n## Risks\n", database: { name: "Work items", props: [["Item", "title"], ["Status", "status"], ["Owner", "person"], ["Timeline", "dateRange"], ["Priority", "select", ["High", "Medium", "Low"]]], views: ["board", "timeline"] } },
  { id: "daily-planner", category: "Personal", name: "Daily planner", icon: "☀️", description: "Priorities, time blocks and an end-of-day review.",
    markdown: "## Top 3\n- [ ] \n- [ ] \n- [ ] \n\n## Schedule\n| Time | Block |\n| --- | --- |\n| 09:00 | |\n| 11:00 | |\n| 14:00 | |\n| 16:00 | |\n\n## End of day\n- What went well?\n- What to change tomorrow?\n" },
  { id: "weekly-planner", category: "Personal", name: "Weekly planner", icon: "📅", description: "Plan each day and review the week.",
    markdown: "## Goals this week\n- [ ] \n\n## Monday\n- [ ] \n## Tuesday\n- [ ] \n## Wednesday\n- [ ] \n## Thursday\n- [ ] \n## Friday\n- [ ] \n\n## Weekly review\n- Wins:\n- Lessons:\n- Next week:\n" },
  { id: "meeting-notes", category: "Work", name: "Meeting notes", icon: "🗣️", description: "Agenda, notes, decisions and action items.",
    markdown: "**Date:** \n**Attendees:** \n\n## Agenda\n1. \n\n## Notes\n\n## Decisions\n- \n\n## Action items\n- [ ] Owner – task – due\n" },
  { id: "research", category: "Education", name: "Research paper organizer", icon: "🔬", description: "Sources, notes and an outline for a paper.",
    markdown: "## Research question\n\n## Thesis\n\n## Outline\n1. Introduction\n2. Background\n3. Method\n4. Findings\n5. Discussion\n", database: { name: "Sources", props: [["Title", "title"], ["Authors", "text"], ["Year", "number"], ["URL", "url"], ["Status", "select", ["To read", "Reading", "Annotated"]], ["Key finding", "text"]] } },
  { id: "reading", category: "Personal", name: "Reading tracker", icon: "📚", description: "Books with status, rating and notes.",
    markdown: "## Reading goal\nBooks this year: \n", database: { name: "Books", props: [["Title", "title"], ["Author", "text"], ["Status", "status"], ["Rating", "rating"], ["Finished", "date"], ["Genre", "multiSelect"]], views: ["board", "gallery"] } },
  { id: "habit", category: "Personal", name: "Habit tracker", icon: "🔥", description: "A daily log with checkboxes per habit.",
    markdown: "Each row is one day. Tick the habits you completed.\n", database: { name: "Habit log", props: [["Day", "title"], ["Date", "date"], ["Exercise", "checkbox"], ["Read", "checkbox"], ["Meditate", "checkbox"], ["Score", "formula"]], views: ["calendar"] } },
  { id: "finance", category: "Personal", name: "Personal finance tracker", icon: "💰", description: "Income and expenses by category.",
    markdown: "## Monthly budget\n| Category | Budget |\n| --- | --- |\n| Housing | |\n| Food | |\n| Transport | |\n", database: { name: "Transactions", props: [["Description", "title"], ["Amount", "currency"], ["Type", "select", ["Income", "Expense"]], ["Category", "select", ["Housing", "Food", "Transport", "Fun", "Salary"]], ["Date", "date"]], views: ["chart", "calendar"] } },
  { id: "dev-tracker", category: "Engineering", name: "Software development tracker", icon: "🐛", description: "Bugs and features with priority and status.",
    markdown: "## Release\n\n## Conventions\n- Branch naming:\n- Definition of done:\n", database: { name: "Issues", props: [["Issue", "title"], ["ID", "uniqueId"], ["Type", "select", ["Bug", "Feature", "Chore"]], ["Status", "status"], ["Priority", "select", ["P0", "P1", "P2"]], ["Assignee", "person"], ["Points", "number"]], views: ["board"] } },
  { id: "roadmap", category: "Engineering", name: "Product roadmap", icon: "🧭", description: "Initiatives on a timeline by quarter.",
    markdown: "## Vision\n\n## Themes\n- \n", database: { name: "Initiatives", props: [["Initiative", "title"], ["Quarter", "select", ["Q1", "Q2", "Q3", "Q4"]], ["Status", "status"], ["Timeline", "dateRange"], ["Impact", "select", ["High", "Medium", "Low"]]], views: ["timeline", "board"] } },
  { id: "crm", category: "Work", name: "CRM", icon: "🤝", description: "Contacts and deals through a pipeline.",
    markdown: "Track leads and deals. Move cards across the board as deals progress.\n", database: { name: "Deals", props: [["Company", "title"], ["Contact", "text"], ["Email", "email"], ["Phone", "phone"], ["Stage", "select", ["Lead", "Qualified", "Proposal", "Won", "Lost"]], ["Value", "currency"], ["Next follow-up", "date"]], views: ["board", "calendar"] } },
  { id: "inventory", category: "Work", name: "Inventory management", icon: "📦", description: "Items, stock levels and reorder flags.",
    markdown: "Items with stock at or below their reorder level need attention.\n", database: { name: "Inventory", props: [["Item", "title"], ["SKU", "text"], ["In stock", "number"], ["Reorder level", "number"], ["Unit cost", "currency"], ["Supplier", "text"], ["Needs reorder", "formula"]] } },
  { id: "resume", category: "Personal", name: "Resume builder", icon: "📄", description: "A structured resume you can export.",
    markdown: "# Your Name\nemail · phone · city · link\n\n## Summary\n\n## Experience\n### Role – Company (Year–Year)\n- Achievement with measurable result\n\n## Education\n\n## Skills\n" },
  { id: "travel", category: "Personal", name: "Travel planner", icon: "✈️", description: "Itinerary, packing list and bookings.",
    markdown: "## Trip overview\n**Dates:** \n**Destination:** \n\n## Packing list\n- [ ] Passport\n- [ ] Chargers\n- [ ] Medication\n", database: { name: "Itinerary", props: [["Activity", "title"], ["Date", "date"], ["Location", "text"], ["Booked", "checkbox"], ["Cost", "currency"]], views: ["calendar"] } },
  { id: "goals", category: "Personal", name: "Goal tracker", icon: "🎯", description: "Goals with progress and target dates.",
    markdown: "Break each goal into measurable key results.\n", database: { name: "Goals", props: [["Goal", "title"], ["Area", "select", ["Health", "Career", "Learning", "Finance"]], ["Progress", "progress"], ["Target date", "date"], ["Status", "status"]], views: ["board"] } },
  { id: "kb", category: "Knowledge", name: "Knowledge base", icon: "🧠", description: "A hub of linked articles with tags.",
    markdown: "## How to use\nCreate sub-pages for each article, link related articles with [[ ]], and tag them with #topic.\n\n## Start here\n- \n\n## Topics\n- #howto\n- #reference\n" },
  { id: "journal", category: "Personal", name: "Journal", icon: "📓", description: "Daily reflection prompts.",
    markdown: "## Grateful for\n- \n\n## Today I…\n\n## On my mind\n\n## Tomorrow\n- [ ] \n" },
];

/** Formulas for templates whose formula property needs a body (by template id + property name). */
export const TEMPLATE_FORMULAS: Record<string, string> = {
  "habit:Score": 'toNumber(prop("Exercise")) + toNumber(prop("Read")) + toNumber(prop("Meditate"))',
  "inventory:Needs reorder": 'if(prop("In stock") <= prop("Reorder level"), "Reorder", "OK")',
};
