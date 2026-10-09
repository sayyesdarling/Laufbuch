// Session types. `cat` controls the colour family in the plan:
// easy = easy running, long = long runs, quality = workouts, test = races and time trials.
// `zone` points at a pace zone in Settings, so "Your pace" follows your own numbers.

export const TYPES = {
  easy: {
    name: "Easy run",
    cat: "easy",
    short: "Relaxed running that builds your base.",
    what: "Continuous running at a pace you could hold for a very long time. Most of your weekly kilometres should be easy.",
    why: "Builds the aerobic engine slowly and cheaply: more capillaries, more mitochondria, stronger tendons. Because it costs little, you recover in time for the hard days.",
    feel: "You can talk in full sentences. Breathing stays calm, and you finish feeling you could keep going.",
    zone: "easy",
    mistakes: [
      "Drifting into 4:10–4:20 /km. That is threshold territory: too hard to recover from properly, too easy to count as a workout.",
      "Chasing the pace on a tired day. Easy is an effort, not a number; slow down if your heart rate climbs."
    ],
    notSame: [
      ["recovery", "A recovery run is shorter and slower still, and its only job is to help you bounce back."],
      ["long", "A long run is easy too, but its length is the point."]
    ]
  },

  recovery: {
    name: "Recovery run",
    cat: "easy",
    short: "Short and very slow, the day after something hard.",
    what: "A short run (usually 20–40 minutes) that is noticeably slower than your normal easy pace.",
    why: "Gets blood moving through tired legs and keeps the habit of running, without adding training stress. It is not meant to make you fitter.",
    feel: "Almost too slow. If anyone asks, you are jogging.",
    zone: "easy",
    mistakes: [
      "Running it at normal easy pace or faster because you feel fine.",
      "Skipping it in favour of a hard session the day after a race."
    ],
    notSame: [
      ["easy", "Easy runs add aerobic training; a recovery run only helps you absorb the previous day."],
      ["shakeout", "A shakeout is shorter and is about readiness (before a race, after travel), not recovery."]
    ]
  },

  shakeout: {
    name: "Shakeout",
    cat: "easy",
    short: "A very short jog to loosen up, not to train.",
    what: "15–30 minutes of very easy jogging, sometimes with 2–4 relaxed strides at the end. Typical the day before a race, the morning of an evening race, or after a long flight.",
    why: "Loosens stiff muscles, settles nerves and, after travel, helps reset your body clock. It has no fitness effect, and that is fine.",
    feel: "Light and unhurried. You should end it feeling fresher than you started.",
    zone: "easy",
    mistakes: [
      "Turning it into a proper run because your legs feel good.",
      "Adding hard surges the day before a race."
    ],
    notSame: [
      ["recovery", "A recovery run follows hard work; a shakeout prepares you for what is next."],
      ["strides", "Strides can be part of a shakeout, but they are short and relaxed there."]
    ]
  },

  strides: {
    name: "Easy run + strides",
    cat: "easy",
    short: "An easy run with a few short, smooth accelerations at the end.",
    what: "After the easy run, 4–8 accelerations of 15–20 seconds each. Build up gradually to about your fastest controlled pace (roughly mile to 3 km race pace), hold it briefly, then ease off. Walk or jog slowly for 45–90 seconds until you feel fully recovered before the next one.",
    why: "Practises good form and quick leg turnover, and keeps the fast-twitch fibres awake, without creating fatigue. Strides are a form drill, not a workout.",
    feel: "Fast but smooth and relaxed: tall posture, loose shoulders, quick light steps. You should never be out of breath when you start the next stride.",
    zone: "reps",
    mistakes: [
      "Sprinting all-out. Strides top out around 90–95% of top speed, never a max effort.",
      "Cutting the recovery short. Once you start the next one tired, they have become intervals.",
      "Doing them on tired legs at the end of a hard day instead of after easy runs."
    ],
    notSame: [
      ["reps", "Reps are a measured workout (200–400 m, set times, many repeats). Strides are short, untimed and done by feel."],
      ["intervals", "Intervals are meant to tire you. Strides should leave you as fresh as before."]
    ]
  },

  long: {
    name: "Long run",
    cat: "long",
    short: "The week's longest run, at easy pace.",
    what: "One run per week clearly longer than the others, run at easy pace from start to finish.",
    why: "Builds endurance: your body gets better at using fat for fuel, and your muscles, tendons and bones adapt to time on your feet. It is the backbone of half and full marathon fitness.",
    feel: "Easy for most of it. The last part may feel tiring because of the duration, not because of the pace.",
    zone: "easy",
    mistakes: [
      "Running it faster as it goes, and turning it into a race.",
      "Not eating or drinking on runs over about 90 minutes."
    ],
    notSame: [
      ["long-steady", "A long run with a steady finish adds a faster final section on purpose."]
    ]
  },

  "long-steady": {
    name: "Long run, steady finish",
    cat: "long",
    short: "Easy long run with the last few kilometres at steady pace.",
    what: "A long run at easy pace, with the final 3–4 km at steady pace: quicker than easy, slower than threshold, about marathon effort.",
    why: "Teaches you to hold a good rhythm on tired legs, which is what the second half of a race feels like.",
    feel: "The steady section is purposeful but controlled: short sentences, not gasping. You finish feeling you could have done another kilometre at that pace.",
    zone: "steady",
    mistakes: [
      "Starting the faster section too early.",
      "Running the finish at threshold or race pace."
    ],
    notSame: [
      ["tempo", "A tempo run is faster and shorter, and runs on fresh legs."]
    ]
  },

  fartlek: {
    name: "Fartlek",
    cat: "quality",
    short: "Continuous running with faster surges mixed in.",
    what: "Swedish for \"speed play\": surges of set time (here 1 minute) inside one continuous run. Between surges you keep running easily; you never stop.",
    why: "A gentle way to bring speed back after a break. It teaches you to change pace and settle again, with less pressure than a track session.",
    feel: "Surges are brisk to hard (around threshold to interval effort). Recoveries are a genuine easy run, not a walk.",
    zone: "threshold",
    mistakes: [
      "Treating the surges as sprints.",
      "Stopping or walking between surges, which turns it into an interval session."
    ],
    notSame: [
      ["intervals", "Intervals use exact distances and paces with standing or jogging breaks. Fartlek is looser and keeps you moving."]
    ]
  },

  tempo: {
    name: "Tempo run",
    cat: "quality",
    short: "20–30 minutes non-stop at threshold.",
    what: "One continuous block at threshold pace, with an easy warm-up before and cool-down after.",
    why: "Raises your lactate threshold: the fastest pace you can sustain without fatigue quickly building up. That pace largely decides your 10 km to half marathon results.",
    feel: "Comfortably hard. You can say a few words, not sentences. At the end you should feel you could have kept going for another 10 minutes.",
    zone: "threshold",
    mistakes: [
      "Racing it. If the last minutes are a fight, you went too fast.",
      "Skipping the warm-up and starting cold."
    ],
    notSame: [
      ["threshold", "Cruise intervals run the same pace but split into chunks with short breaks."],
      ["intervals", "VO2max intervals are faster and much harder, in shorter pieces."]
    ]
  },

  threshold: {
    name: "Cruise intervals",
    cat: "quality",
    short: "Threshold pace split into long reps with short breaks.",
    what: "Repeats of 2–3 km (or 6–12 minutes) at threshold pace, with only 60–120 seconds of easy jogging between them.",
    why: "Same goal as a tempo run, raising your threshold, but the short breaks let you spend more total time at that pace with less strain.",
    feel: "Like a tempo run, comfortably hard. The breaks are short, so your heart rate barely drops before the next rep.",
    zone: "threshold",
    mistakes: [
      "Running the reps faster because the breaks make it feel easier. Stay at threshold.",
      "Turning the breaks into long standing rests."
    ],
    notSame: [
      ["tempo", "A tempo run is the same pace without breaks."],
      ["intervals", "VO2max intervals are clearly faster, with longer recoveries."]
    ]
  },

  intervals: {
    name: "Intervals (VO2max)",
    cat: "quality",
    short: "Hard repeats of 3–6 minutes with jog recoveries.",
    what: "Repeats of 800–1600 m at roughly 3–5 km race effort. Between them, jog for about 2–3 minutes, slightly shorter than the rep itself.",
    why: "Pushes your heart and lungs close to their maximum and raises your VO2max, the ceiling of your aerobic engine.",
    feel: "Hard. Breathing is heavy by the end of each rep, and the last reps take real focus. Heart rate climbs toward 95% of max in the later reps.",
    zone: "interval",
    mistakes: [
      "Running the first rep too fast and fading. Aim for even reps; the last can be slightly quicker.",
      "Standing still during recoveries. Jog slowly."
    ],
    notSame: [
      ["reps", "Reps are shorter and faster, with full recovery, and train speed and form rather than the aerobic system."],
      ["threshold", "Cruise intervals are slower, longer and more controlled."]
    ]
  },

  reps: {
    name: "Reps (speed)",
    cat: "quality",
    short: "Short, fast repeats with full recovery.",
    what: "Repeats of 200–400 m at about mile pace or a bit faster, with a slow jog of the same distance between them. Here: 200 m in 40–42 s, or 400 m in 82–86 s.",
    why: "Improves speed and running economy, so your race paces cost less energy. The full recoveries keep form and quality high on every rep.",
    feel: "Fast but relaxed. Each rep should look the same as the first. Don't watch heart rate; the reps are too short for it to mean much.",
    zone: "reps",
    mistakes: [
      "Shortening the recoveries to make it harder. That changes the purpose.",
      "Straining with clenched fists and shoulders. Fast and loose beats fast and tense."
    ],
    notSame: [
      ["strides", "Strides are untimed, shorter and fewer, tacked onto an easy run."],
      ["intervals", "Intervals are longer and aimed at your aerobic system, so they are meant to tire you."]
    ]
  },

  hills: {
    name: "Hill sprints",
    cat: "quality",
    short: "Very short, near-max efforts uphill.",
    what: "8–12 seconds of hard running up a steep hill, then a full walk-back recovery of 1–2 minutes. Usually 4–8 reps.",
    why: "Builds power and stride strength with lower impact than flat sprinting.",
    feel: "Powerful and short. You should not be breathing hard at the top.",
    zone: null,
    mistakes: [
      "Running them on tired legs. They load the Achilles and calves heavily, so with your history start with 4 reps.",
      "Making them longer than 15 seconds, which turns them into anaerobic intervals."
    ],
    notSame: [
      ["strides", "Strides are on flat ground and below max effort."]
    ]
  },

  tt: {
    name: "Time trial",
    cat: "test",
    short: "A solo all-out effort over a set distance.",
    what: "Race effort over a fixed distance, on a flat, measured route or in a local race. Warm up properly as you would for a race.",
    why: "Measures your current fitness and gives you the numbers for the next block's pace zones.",
    feel: "Race-hard. Start slightly conservatively, build through the middle, and empty the tank in the last 2 km.",
    zone: null,
    mistakes: [
      "Starting too fast and fading. Even or slightly negative splits give the most accurate result.",
      "Doing it tired. The taper week exists so the result means something."
    ],
    notSame: []
  },

  wucd: {
    name: "Warm-up and cool-down",
    cat: "easy",
    short: "The easy running before and after every workout.",
    what: "Warm-up: 2–2.5 km easy, then 4 strides. Cool-down: 1–2 km easy. Both count towards the session's kilometres.",
    why: "The warm-up raises heart rate and muscle temperature gradually, so the first rep isn't a shock to your tendons. The cool-down eases you back down.",
    feel: "Easy. The warm-up's strides should leave you feeling sharp, not tired.",
    zone: "easy",
    mistakes: [
      "Cutting the warm-up short when time is tight. Shorten the main set instead."
    ],
    notSame: []
  }
};

// Order used in menus and in the guide.
export const TYPE_ORDER = ["easy", "recovery", "shakeout", "strides", "wucd", "long", "long-steady", "fartlek", "tempo", "threshold", "intervals", "reps", "hills", "tt"];

// The "at a glance" table for the sessions that are easiest to confuse.
export const COMPARE = [
  { key: "strides", hard: "15–20 s", rest: "45–90 s walk, full", effort: "Fast, smooth, never all-out", aim: "Form and turnover" },
  { key: "reps", hard: "200–400 m", rest: "Same distance, slow jog", effort: "About mile pace, relaxed", aim: "Speed and economy" },
  { key: "intervals", hard: "3–6 min", rest: "2–3 min jog", effort: "Hard, 3–5 km race", aim: "VO2max" },
  { key: "threshold", hard: "2–3 km", rest: "60–120 s jog", effort: "Comfortably hard", aim: "Threshold" },
  { key: "tempo", hard: "20–30 min", rest: "None", effort: "Comfortably hard", aim: "Threshold" },
  { key: "fartlek", hard: "Surges by time", rest: "Easy running", effort: "Brisk to hard", aim: "Gentle speed" },
  { key: "shakeout", hard: "None", rest: "—", effort: "Very easy", aim: "Loosen up" }
];
