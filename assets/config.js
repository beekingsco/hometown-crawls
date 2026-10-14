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
    coupon: {
      reward: "$1 off next drink",
      expiryDays: 30,
      issued: 64,
      redeemed: 11
    },
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
  }
};
