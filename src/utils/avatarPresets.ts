export interface AvatarPreset {
  id: string;
  name: string;
  category: 'Cinematic' | 'Anime & Art' | 'Cute & Fun' | 'Modern';
  url: string;
}

export const AVATAR_PRESETS: AvatarPreset[] = [
  // Cinematic & Tech
  {
    id: 'cyber-pilot',
    name: 'Cyber Pilot',
    category: 'Cinematic',
    url: 'https://api.dicebear.com/7.x/bottts/svg?seed=CyberPilot&backgroundColor=1e1b4b',
  },
  {
    id: 'movie-director',
    name: 'Movie Director',
    category: 'Cinematic',
    url: 'https://api.dicebear.com/7.x/notionists/svg?seed=Director&backgroundColor=31104b',
  },
  {
    id: 'retro-synth',
    name: 'Retro Synth',
    category: 'Cinematic',
    url: 'https://api.dicebear.com/7.x/bottts/svg?seed=NeonRetro&backgroundColor=4c0519',
  },
  {
    id: 'astro-voyager',
    name: 'Astro Voyager',
    category: 'Cinematic',
    url: 'https://api.dicebear.com/7.x/bottts/svg?seed=StarGazer&backgroundColor=0f172a',
  },

  // Anime & Art
  {
    id: 'anime-hero',
    name: 'Anime Hero',
    category: 'Anime & Art',
    url: 'https://api.dicebear.com/7.x/lorelei/svg?seed=Hero&backgroundColor=1e293b',
  },
  {
    id: 'anime-sakura',
    name: 'Sakura Blossom',
    category: 'Anime & Art',
    url: 'https://api.dicebear.com/7.x/lorelei/svg?seed=Sakura&backgroundColor=4a044e',
  },
  {
    id: 'mystic-dreamer',
    name: 'Mystic Dreamer',
    category: 'Anime & Art',
    url: 'https://api.dicebear.com/7.x/lorelei/svg?seed=Dreamer&backgroundColor=2e1065',
  },
  {
    id: 'art-sketch',
    name: 'Sketch Artist',
    category: 'Anime & Art',
    url: 'https://api.dicebear.com/7.x/croodles/svg?seed=Artist&backgroundColor=134e4a',
  },

  // Cute & Fun
  {
    id: 'popcorn-party',
    name: 'Popcorn Star',
    category: 'Cute & Fun',
    url: 'https://api.dicebear.com/7.x/fun-emoji/svg?seed=Popcorn&backgroundColor=78350f',
  },
  {
    id: 'cool-cat',
    name: 'Cool Cat',
    category: 'Cute & Fun',
    url: 'https://api.dicebear.com/7.x/adventurer/svg?seed=Felix&backgroundColor=064e3b',
  },
  {
    id: 'happy-vibes',
    name: 'Happy Vibes',
    category: 'Cute & Fun',
    url: 'https://api.dicebear.com/7.x/fun-emoji/svg?seed=SmileJoy&backgroundColor=831843',
  },
  {
    id: 'magic-rabbit',
    name: 'Magic Rabbit',
    category: 'Cute & Fun',
    url: 'https://api.dicebear.com/7.x/adventurer/svg?seed=Rabbit&backgroundColor=1e1b4b',
  },

  // Modern & Minimalist
  {
    id: 'modern-micah',
    name: 'Minimal Blue',
    category: 'Modern',
    url: 'https://api.dicebear.com/7.x/micah/svg?seed=BlueEcho&backgroundColor=0c4a6e',
  },
  {
    id: 'modern-amber',
    name: 'Warm Amber',
    category: 'Modern',
    url: 'https://api.dicebear.com/7.x/micah/svg?seed=AmberAura&backgroundColor=713f12',
  },
  {
    id: 'modern-violet',
    name: 'Neon Violet',
    category: 'Modern',
    url: 'https://api.dicebear.com/7.x/micah/svg?seed=VioletGlow&backgroundColor=581c87',
  },
  {
    id: 'modern-emerald',
    name: 'Fresh Emerald',
    category: 'Modern',
    url: 'https://api.dicebear.com/7.x/micah/svg?seed=EmeraldBreeze&backgroundColor=064e3b',
  },
];
