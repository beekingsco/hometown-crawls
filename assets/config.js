/* Public client config — anon key is safe to ship.
   Guest contact scope and the Anthem demo fixture live here so the owner
   can change the wording or the sample numbers in one place. */
window.__HC_ENV__ = {
  SUPABASE_URL: "https://tatwbjuwufeqynpufodq.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRhdHdianV3dWZlcXlucHVmb2RxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg4ODI3ODYsImV4cCI6MjEwNDQ1ODc4Nn0.FHefwovFLe-MYL11yTeRqLlwBsDyD1KpfkmhBRr0zEQ",
  CRAWL_ID: "puy-coffee",
  SITE_NAME: "Hometown Crawls",
  GUEST_CONTACT: {
    statement: "I agree that participating stores and organizers can access my info to contact me about prizes and future offers.",
    privacyEmail: "privacy@hometowncrawls.com",
    /* Export scopes passed to the guest-export RPC. Store = guests on crawls
       this shop is in. Organizer = guests on crawls this person organizes. */
    scopes: {
      store: "store",
      organizer: "organizer"
    }
  },
  /* Sample crawl for the Anthem store demo. Shown only when ?demo=1
     or when live totals are empty. Every figure is labeled DEMO DATA. */
  DEMO_STORE: {
    label: "DEMO DATA",
    shop: {
      name: "Anthem Coffee & Tea",
      storeCode: "ANTHEMCO",
      businessId: "anthem",
      crawlId: "puy-coffee",
      crawlName: "Puyallup Holiday Coffee Crawl"
    },
    stats: {
      players: 128,
      scans: 412,
      shopScans: 64,
      firstTime: 27
    },
    sampleStamps: 5,
    bonus: {
      kind: "follow",
      label: "Follow @anthemcoffee on Instagram",
      url: "https://www.instagram.com/anthemcoffee",
      entries: 2
    },
    coupon: {
      enabled: false,
      reward: "$1 off next drink",
      expiryDays: 30,
      issued: 64,
      redeemed: 11
    },
    listing: {
      address: "210 W Pioneer Ave, Puyallup, WA 98371",
      phone: "2539882492",
      hours: "",
      description: "",
      website: "",
      instagram: ""
    },
    dates: { start: "2026-11-01", end: "2026-12-31", label: "Nov 1 – Dec 31, 2026" },
    gamePath: "/play",
    gameHost: "hometowncrawls.com/play",
    crawlUrl: "https://www.hometowncrawls.com/puyallup/holiday-coffee-crawl",
    codeAlphabet: "ABCDEFGHJKLMNPQRSTUVWXYZ23456789",
    /* Consented guests only. Rows without consentedAt are never shown or exported. */
    guests: [
      {
        name: "Jordan Lee",
        email: "jordan.lee@example.com",
        crawlsJoined: "Puyallup Holiday Coffee Crawl",
        stamps: 5,
        consentedAt: "2026-10-08T15:12:00Z"
      },
      {
        name: "Sam Ortiz",
        email: "sam.ortiz@example.com",
        crawlsJoined: "Puyallup Holiday Coffee Crawl",
        stamps: 3,
        consentedAt: "2026-10-09T19:40:00Z"
      },
      {
        name: "Priya Shah",
        email: "priya.shah@example.com",
        crawlsJoined: "Puyallup Holiday Coffee Crawl",
        stamps: 8,
        consentedAt: "2026-10-10T16:05:00Z"
      },
      {
        name: "Chris Nguyen",
        email: "chris.nguyen@example.com",
        crawlsJoined: "Puyallup Holiday Coffee Crawl",
        stamps: 2,
        consentedAt: "2026-10-11T21:18:00Z"
      }
    ]
  },
  /* Sample organizer view for ?demo=1. Bryan organizes puy-coffee and can
     switch crawls. Figures are labeled DEMO DATA. */
  DEMO_ORGANIZER: {
    label: "DEMO DATA",
    person: {
      name: "Bryan Reynolds",
      email: "bryan@myanthemcoffee.com",
      role: "organizer"
    },
    crawls: [
      {
        id: "puy-coffee",
        title: "Puyallup Holiday Coffee Crawl",
        city: "Puyallup",
        starts: "2026-11-01",
        ends: "2026-12-31",
        stores: [
          { name: "Anthem Coffee & Tea", code: "ANTHEMCO", paid: true, scans: 64 },
          { name: "Pioneer Pour House", code: "KNWD7H", paid: true, scans: 51 },
          { name: "Meridian Coffee Bar", code: "R4ST9M", paid: true, scans: 47 },
          { name: "Main Street Roasters", code: "H7CWLP", paid: false, scans: 0 }
        ]
      },
      {
        id: "puy-summer-demo",
        title: "Puyallup Summer Sip",
        city: "Puyallup",
        starts: "2027-06-01",
        ends: "2027-08-31",
        stores: [
          { name: "Anthem Coffee & Tea", code: "ANTHEMCO", paid: true, scans: 12 },
          { name: "Valley Tea Room", code: "B6NDQK", paid: false, scans: 0 }
        ]
      }
    ]
  }
};
