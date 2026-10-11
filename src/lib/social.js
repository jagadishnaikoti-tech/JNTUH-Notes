// Social channel icon registry shared by the admin editor and the public
// sidebar/footer display. Keys are stored in Firestore (`channels/{id}.icon`).
import {
  Facebook,
  Github,
  Globe,
  Instagram,
  Link as LinkIcon,
  Linkedin,
  MessageCircle,
  Music2,
  Rss,
  Send,
  Twitter,
  Youtube,
} from "lucide-react";

export const SOCIAL_ICONS = {
  youtube: { label: "YouTube", Icon: Youtube },
  instagram: { label: "Instagram", Icon: Instagram },
  facebook: { label: "Facebook", Icon: Facebook },
  twitter: { label: "X / Twitter", Icon: Twitter },
  linkedin: { label: "LinkedIn", Icon: Linkedin },
  telegram: { label: "Telegram", Icon: Send },
  whatsapp: { label: "WhatsApp", Icon: MessageCircle },
  github: { label: "GitHub", Icon: Github },
  spotify: { label: "Spotify", Icon: Music2 },
  rss: { label: "RSS / Blog", Icon: Rss },
  website: { label: "Website", Icon: Globe },
  other: { label: "Other link", Icon: LinkIcon },
};

export const SOCIAL_ICON_KEYS = Object.keys(SOCIAL_ICONS);

export function socialIcon(key) {
  return SOCIAL_ICONS[key] || SOCIAL_ICONS.other;
}
