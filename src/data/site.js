// Central site content & resource metadata.
// All labels, headings and links below are preserved verbatim from the
// reference website: https://cselnr223.ccbp.tech/
//
// The reference site links to public Google Drive *folders*. Every folder and
// every individual file inside it was enumerated (see src/data/resources.json)
// so the React rebuild can expose each document with its original Drive URL.

import resources from "./resources.json";
import {
  BriefcaseBusiness,
  FolderKanban,
  Map as MapIcon,
  MessagesSquare,
  NotebookText,
  SquareTerminal,
  Trophy,
} from "lucide-react";

export { resources };

const byFolderId = new Map();
const byLabel = new Map();
for (const group of Object.values(resources.groups)) {
  for (const item of group) {
    byFolderId.set(item.folderId, item);
    byLabel.set(item.label + "::" + item.folderId, item);
  }
}

export const getResourceByFolderId = (id) => byFolderId.get(id) || null;
export const getResource = (groupId, label) =>
  (resources.groups[groupId] || []).find((r) => r.label === label) || null;

// ---- Verbatim site chrome text -------------------------------------------
export const SITE = {
  brand: "CSE & AIML · R22",
  navNote: "Free to use. No sign-up required.",
  searchPlaceholder: "Don't Stress. Do your Best. Forget the Rest.",
  // `author` is the original copyright-credits handle preserved verbatim from
  // the reference site (shown inside the COPYRIGHTS dialog only).
  author: "JASHVA",
  // `developer` is the visible developer attribution shown in the sidebar and
  // footer. Rebranded from "JASHVA" to "Jagadish" as requested.
  developer: "Jagadish",
  heading: "JNTUH Notes",
  tagline:
    "Your one-stop hub for JNTUH R22 CSE, AIML & AIDS! Get notes, important questions, and previous papers.",
  meta: [
    "Course: B.Tech",
    "Branch: CSE & AIML",
    "Regulation: R22",
    "Board: JNTUH",
  ],
};

// ---- External & special links (original destinations, unchanged) ----------
export const LINKS = {
  whatsappShare:
    "https://wa.me/?text=Hey,--I-found-this-LINK-It's-very-helpful-for-our-Exam-Preparation-\u{1F4CC}https://cselnr223.ccbp.tech/",
  feedback: "https://wa.link/4q29q4",
  updatePdfs: "https://wa.link/0zayru",
  results: "https://jntuhresults.vercel.app/academicresult",
  authorProfile: "https://linktr.ee/faith_enhancer",
  guaranteeQns: "https://jntuh-iq.vercel.app/",
  cseBot: "http://t.me/CSE_Helper_bot",
  r18: "https://drive.google.com/drive/folders/14BR8ItAGLYSSvvVkDiDMQH9HdM_M91od?usp=sharing",
  r22Syllabus:
    "https://drive.google.com/drive/folders/1kl723nNIZpQqBS5PkMpyARN-Nex1spwT",
  codeFeedback: "https://wa.link/75g1md",
};

// ---- "Learn Code" links (from #sectioncode) -------------------------------
// `icon` is a Lucide component used by the sidebar and the Learn Code cards.
export const CODE_LINKS = [
  { label: "NOTES", url: "https://drive.google.com/drive/folders/1iRu-rmlZXdMYuPjlustJ-WuZ8diGOMLx", external: true, icon: NotebookText },
  { label: "ROAD-MAP", url: "https://roadmap.sh/", external: true, icon: MapIcon },
  { label: "INTERVIEW QN's", url: "https://drive.google.com/drive/folders/1hfjcoHPZkwjHuXB08mlyDvzDeOClxKiA", external: true, icon: MessagesSquare },
  { label: "INTERNSHIP", url: "https://www.codsoft.in/", external: true, icon: BriefcaseBusiness },
  { label: "PROJECTS", url: "https://drive.google.com/drive/folders/1iC3GyREkftJT-3l37Uz1cWDXFxW8y72l", external: true, icon: FolderKanban },
  { label: "PLACEMENT", url: "https://drive.google.com/drive/u/0/mobile/folders/1SkCOcAS0Kqvuz-MJkkjbFr1GSue6Ms6m", external: true, icon: Trophy },
  { label: "PRACTICE", url: "https://www.codechef.com/ide", external: true, icon: SquareTerminal },
];

// ---- Year -> subject folder links (exact order & labels from reference) ----
// extras render as the plain "Important Questions" / "R22 Previous Question
// Papers" text links shown at the bottom of each year section.
export const YEARS = [
  {
    id: 1,
    name: "1st Year",
    subjects: [
      { label: "M1 M2", folderId: "1LHPX3Zo-lAi-YL5wf2IA4KSMGIQe8AJq" },
      { label: "PPS", folderId: "1MSTFxfF1nUJ3V38BEma61qkuWqEulPaY" },
      { label: "AP", folderId: "1MMb2UQI0jHKbUzih_1OX5HQ226RBXVn2" },
      { label: "ENG", folderId: "1MK5DdUXW5ME-DnMW8_MYVZOKpsD2RB4u" },
      { label: "BEE", folderId: "1glYohtTM6ptEudoYwCNKynlAigwInTjV" },
      { label: "EDC", folderId: "1MMD0rjnv2SKQVp6b5B6AfdMpT56H2DSN" },
      { label: "CAEG", folderId: "1dlu9hJ44vAbprx3_dxKuuU0_TlZR1prM" },
      { label: "CHEM", folderId: "1hY5rckMoFJ5LXwyLK2gng0028fIi2n2d" },
    ],
    extras: [
      { label: "Important Questions", folderId: "1KzasgqcGh6_MCwjWqSAnB8wG8p_7TK8N" },
      { label: "R22 Previous Question Papers", folderId: "1KVB3WUBf_3UPhNfTdREIuJIutbDBoKcU" },
    ],
  },
  {
    id: 2,
    name: "2nd Year",
    subjects: [
      { label: "COSM", folderId: "1qovgGl6Bja24HNj4oU5-UbgX8ZTkCYBT" },
      { label: "MSF", folderId: "1-gRtgAuWPug55MP_AXDjtsF26isQXgcr" },
      { label: "DM", folderId: "1eea3CbX7MzOdPWLyOscOLzzsGw2vaOjO" },
      { label: "COA", folderId: "1l6U_FcgXlFrZZMnY-Gr6RlqsMZoJCQnU" },
      { label: "JAVA", folderId: "1r88phLO0j5IGMeVVd2FBgisCV4iXPLQ6" },
      { label: "DBMS", folderId: "1eWfZteUvaRuD89F8BWibCIlzXAhdjqBv" },
      { label: "BEFA", folderId: "1e_q_ht8AoMKyDueW9Usx0mncNkYuxVpB" },
      { label: "LABS", folderId: "1q7HdV5CLtxLxa345e8I99fgvlDWp8VK1" },
      { label: "OS", folderId: "1bUhmQUZdgItKXcLjldk2IUcdBxzVjC9v" },
      { label: "DS", folderId: "1r-u9MooJE4rhU3zVG-cxVdlg6IlIe1bo" },
      { label: "DE", folderId: "1jZ6H30aoBW8ahs_3T31FNI6_Q42qi6zL" },
      { label: "SE", folderId: "1edJbs_nkbRazcOMq40SalMPsoeOBrlLr" },
    ],
    extras: [
      { label: "Important Questions", folderId: "1LiHRY7B1Z0cHOzcdEhNqs-VPSCZ3m5eE" },
      { label: "R22 Previous Question Papers", folderId: "1Z7v6X66tgtpXGdsBiCWH1JyYcVjPbS-W" },
    ],
  },
  {
    id: 3,
    name: "3rd Year",
    subjects: [
      { label: "DevOps", folderId: "1lhYUvMBiY3KXrfFo5HjiT-PjsejmbhF1" },
      { label: "DAA", folderId: "1ljY1MgcWGVLCZ9hRHNaPffYa0JAuCD8y" },
      { label: "IRS", folderId: "1lqKeHxfc0AR3Nn0q-O1SzQkm3AD1PIh0" },
      { label: "IDS", folderId: "12Rr0_pvh3pJWvg1UWjQb2NX7e2jXdrIQ" },
      { label: "PPL", folderId: "12e1jTNZFWOxHlfAaX_g0FHN3Yiz_sU6a" },
      { label: "BEFA", folderId: "1e_q_ht8AoMKyDueW9Usx0mncNkYuxVpB" },
      { label: "NLP", folderId: "1lsJyrJhGlcIfXUe5Sn-iE3Eb8sVAI8DJ" },
      { label: "CN", folderId: "1YP1SAL7zZjcdeC0JxTkmJUptgyAQ2ZGT" },
      { label: "DA", folderId: "1mDkgkoRPkZD5ytOTBW0p53OzqzblqXEs" },
      { label: "LABS", folderId: "1-tBXNf1a4ISX9AkMwWRj7xuG10_352iu" },
      { label: "FLAT", folderId: "1-q9IOoAkQR2V70BVG2aUa-iKQGDlIBN_" },
      { label: "FIoT", folderId: "1TfETCJGWxza9kjmWX4fFNO__-CPYWE_-" },
      { label: "STM", folderId: "1aBzCZfpY_F581eAykLENupZJw2pm52HH" },
      { label: "AI", folderId: "1UILdNkRttSnuF2hm4PBSx8pxr98yBrlm" },
      { label: "ML", folderId: "1alQr3MBfFrvDiWlazlZG3OK6SxVDVO_o" },
    ],
    extras: [],
  },
  {
    id: 4,
    name: "4th Year",
    subjects: [
      { label: "CC", folderId: "1j8u9QNyJW8zaxvAELcF3XYzlwDWaYd-F" },
      { label: "CD", folderId: "1Mlbzz1UNUO5FS8bfL55OxpxykXB6RfHx" },
      { label: "CNS", folderId: "1yGGOR788SIzVHM8atbVnobpUxNhZqmBA" },
      { label: "SMS", folderId: "1yiRAlVSzGM_TiJSsDcWvDyGTeLyKhL1H" },
      { label: "NIC", folderId: "1XUvv8sY_y2WIB1RsO-jWL-mI24eOCa1A" },
      { label: "SPPM", folderId: "15IaErt4Pi1vtVAHtnd6r4vbdCYwbAaOA" },
      { label: "IEM", folderId: "1rqbVb9wSJoT30ZGlJV2I2owMHg9ihosC" },
      { label: "MC", folderId: "1anmRW-42q2pKq5aTRevQn3ByCdPSxfkq" },
      // SVP has an empty href ("") on the reference site - preserved as a
      // disabled/coming-soon entry rather than inventing a destination.
      { label: "SVP", folderId: "", disabled: true },
      { label: "LABS", folderId: "1D-aRww0SoLhHEXSQdxsCznVzkIMZKuP8" },
      { label: "OB", folderId: "1OfFe53uahO3EeQCjuCWHiXZYyUoRpd0r" },
      { label: "ED", folderId: "1XQlOln8RYt46xYq5S5IP0JMvZDopFW_7" },
      { label: "DS", folderId: "1sMLTYGHHBRkf8dXGrC0YE7QwDqEg-hiR" },
      { label: "WS", folderId: "1YBiikSiTlHxgi2dLQ7vXR7EwdEWcllCJ" },
      { label: "HCI", folderId: "1rpT0yWjOxLk24HFqyUfHU5ZryZcfOa-O" },
    ],
    extras: [
      { label: "Important Questions", folderId: "1INd-6RhfWOEPRgpwdxDkDXUjLbwCZlh6" },
    ],
  },
];

export const getYear = (id) => YEARS.find((y) => String(y.id) === String(id)) || null;

// Real (crawled) counts for a year: number of linked subjects and the total
// number of documents inside their Drive folders.
export const getYearStats = (year) => {
  let subjects = 0;
  let files = 0;
  for (const s of year.subjects) {
    if (s.disabled || !s.folderId) continue;
    subjects += 1;
    const resource = byFolderId.get(s.folderId);
    if (resource) files += resource.stats.files;
  }
  for (const extra of year.extras || []) {
    const resource = byFolderId.get(extra.folderId);
    if (resource) files += resource.stats.files;
  }
  return { subjects, files };
};

// ---- Helpers for file listings --------------------------------------------
export const extLabel = (ext) => (ext ? ext.toUpperCase() : "FILE");
