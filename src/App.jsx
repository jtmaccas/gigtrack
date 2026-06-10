import React, { useState, useEffect, useCallback, useRef } from "react";
import { supabase, signInAnonymouslyIfNeeded, sendMagicLink, signOut, saveProfile, fetchProfile } from "./supabase.js";
import { syncShift, deleteShiftCloud, reconcileShifts, fetchAllShifts } from "./cloudSync.js";

// ─────────────────────────────────────────────
// ATO CONFIGURATION
// UPDATE THIS RATE EACH NEW FINANCIAL YEAR
// Current rate: 2025-2026 @ 88c/km
// Source: ato.gov.au/individuals-and-families/income-deductions-offsets-and-records/deductions-you-can-claim/vehicle-and-travel-expenses/car-expenses
const ATO_RATE_PER_KM = 0.88;
const ATO_KM_CAP = 5000;
const ATO_KM_WARNING = 4500;
const ATO_FY_LABEL = "2025–26";
// ─────────────────────────────────────────────

// ─────────────────────────────────────────────
// SCORING TARGETS — defaults
// PREMIUM: users can override these in Settings
// ─────────────────────────────────────────────
const DEFAULT_TARGETS = {
  hourly:    40,    // $ per hour
  perDel:    12.50, // $ per delivery
  activeKm:  85,    // % of KMs on active delivery
  activeTime: 85,   // % of online time active
};
const SCORE_CAP = 1.5; // max ratio per category (150%)
// ─────────────────────────────────────────────

// ─────────────────────────────────────────────
// REGIONS & COMMUNITY BENCHMARKS
// Seeded realistic data per region.
// When Firebase connects, replace getRegionBenchmark()
// with a live Firestore aggregate query.
// ─────────────────────────────────────────────
const REGIONS = [
  // ── QLD ──────────────────────────────────────────────────
  // Greater Brisbane North
  { id: "qld-bne-n-caboolture",      label: "Caboolture & Morayfield",        state: "QLD", group: "Greater Brisbane North" },
  { id: "qld-bne-n-northlakes",      label: "North Lakes & Redcliffe",        state: "QLD", group: "Greater Brisbane North" },
  { id: "qld-bne-n-stafford",        label: "Stafford & Eagle Farm",          state: "QLD", group: "Greater Brisbane North" },
  { id: "qld-bne-n-albanycreek",     label: "Albany Creek & Ferny Grove",     state: "QLD", group: "Greater Brisbane North" },
  { id: "qld-bne-n-chermside",       label: "Chermside & Aspley",             state: "QLD", group: "Greater Brisbane North" },
  // Brisbane Inner
  { id: "qld-bne-i-cbd",             label: "Brisbane CBD & Fortitude Valley",state: "QLD", group: "Brisbane Inner" },
  { id: "qld-bne-i-southbris",       label: "South Brisbane & West End",      state: "QLD", group: "Brisbane Inner" },
  // Brisbane East
  { id: "qld-bne-e-cannonhill",      label: "Cannon Hill & Carindale",        state: "QLD", group: "Brisbane East" },
  { id: "qld-bne-e-wynnum",          label: "Wynnum & Capalaba",              state: "QLD", group: "Brisbane East" },
  { id: "qld-bne-e-cleveland",       label: "Cleveland & Redland Bay",        state: "QLD", group: "Brisbane East" },
  // Brisbane South
  { id: "qld-bne-s-tarragindi",      label: "Tarragindi & Holland Park",      state: "QLD", group: "Brisbane South" },
  { id: "qld-bne-s-sunnybank",       label: "Sunnybank & Calamvale",          state: "QLD", group: "Brisbane South" },
  { id: "qld-bne-s-logan",           label: "Logan & Slacks Creek",           state: "QLD", group: "Brisbane South" },
  { id: "qld-bne-s-beenleigh",       label: "Beenleigh & Jimboomba",          state: "QLD", group: "Brisbane South" },
  // Brisbane West
  { id: "qld-bne-w-indooroopilly",   label: "Indooroopilly & Toowong",        state: "QLD", group: "Brisbane West" },
  { id: "qld-bne-w-kenmore",         label: "Kenmore & Jindalee",             state: "QLD", group: "Brisbane West" },
  // Ipswich Region
  { id: "qld-ipswich-central",       label: "Ipswich & Goodna",               state: "QLD", group: "Ipswich Region" },
  { id: "qld-ipswich-springfield",   label: "Springfield & Surrounds",        state: "QLD", group: "Ipswich Region" },
  // Gold Coast North
  { id: "qld-gc-n-coomera",          label: "Coomera & Pimpama",              state: "QLD", group: "Gold Coast North" },
  { id: "qld-gc-n-helensvale",       label: "Helensvale & Oxenford",          state: "QLD", group: "Gold Coast North" },
  // Gold Coast Central
  { id: "qld-gc-c-southport",        label: "Southport & Labrador",           state: "QLD", group: "Gold Coast Central" },
  { id: "qld-gc-c-surfers",          label: "Surfers Paradise & Main Beach",  state: "QLD", group: "Gold Coast Central" },
  { id: "qld-gc-c-nerang",           label: "Nerang & Carrara",               state: "QLD", group: "Gold Coast Central" },
  // Gold Coast South
  { id: "qld-gc-s-broadbeach",       label: "Broadbeach & Mermaid Beach",     state: "QLD", group: "Gold Coast South" },
  { id: "qld-gc-s-burleigh",         label: "Burleigh Heads & Miami",         state: "QLD", group: "Gold Coast South" },
  { id: "qld-gc-s-robina",           label: "Robina & Varsity Lakes",         state: "QLD", group: "Gold Coast South" },
  // Gold Coast Far South
  { id: "qld-gc-fs-palmbeach",       label: "Palm Beach & Coolangatta",       state: "QLD", group: "Gold Coast Far South" },
  // Darling Downs
  { id: "qld-dd-toowoomba",          label: "Toowoomba & Surrounds",          state: "QLD", group: "Darling Downs" },
  // Other QLD (kept for now until rezoned)
  { id: "qld-sunshine-coast",        label: "Sunshine Coast",                 state: "QLD" },
  { id: "qld-regional-central",      label: "Regional Central QLD",           state: "QLD" },
  { id: "qld-regional-north",        label: "Regional North QLD",             state: "QLD" },
  // ── NSW ──────────────────────────────────────────────────
  // Sydney Inner
  { id: "nsw-syd-i-cbd",             label: "Sydney CBD & Surry Hills",        state: "NSW", group: "Sydney Inner" },
  { id: "nsw-syd-i-pyrmont",         label: "Pyrmont & Ultimo",                state: "NSW", group: "Sydney Inner" },
  { id: "nsw-syd-i-newtown",         label: "Newtown & Glebe",                 state: "NSW", group: "Sydney Inner" },
  // Sydney East
  { id: "nsw-syd-e-bondi",           label: "Bondi & Bronte",                  state: "NSW", group: "Sydney East" },
  { id: "nsw-syd-e-doublebay",       label: "Double Bay & Paddington",         state: "NSW", group: "Sydney East" },
  { id: "nsw-syd-e-randwick",        label: "Randwick & Coogee",               state: "NSW", group: "Sydney East" },
  { id: "nsw-syd-e-maroubra",        label: "Maroubra & Eastgardens",          state: "NSW", group: "Sydney East" },
  // Sydney North
  { id: "nsw-syd-n-northsydney",     label: "North Sydney & Mosman",           state: "NSW", group: "Sydney North" },
  { id: "nsw-syd-n-chatswood",       label: "Chatswood & Lane Cove",           state: "NSW", group: "Sydney North" },
  { id: "nsw-syd-n-hornsby",         label: "Hornsby & Asquith",               state: "NSW", group: "Sydney North" },
  // Sydney Northern Beaches
  { id: "nsw-syd-nb-manly",          label: "Manly & Dee Why",                 state: "NSW", group: "Sydney Northern Beaches" },
  { id: "nsw-syd-nb-brookvale",      label: "Brookvale & Frenchs Forest",      state: "NSW", group: "Sydney Northern Beaches" },
  { id: "nsw-syd-nb-monavale",       label: "Mona Vale & Avalon",              state: "NSW", group: "Sydney Northern Beaches" },
  // Sydney Inner West
  { id: "nsw-syd-iw-marrickville",   label: "Marrickville & Leichhardt",       state: "NSW", group: "Sydney Inner West" },
  { id: "nsw-syd-iw-burwood",        label: "Burwood & Strathfield",           state: "NSW", group: "Sydney Inner West" },
  { id: "nsw-syd-iw-ashfield",       label: "Ashfield & Five Dock",            state: "NSW", group: "Sydney Inner West" },
  // Sydney West
  { id: "nsw-syd-w-parramatta",      label: "Parramatta & Granville",          state: "NSW", group: "Sydney West" },
  { id: "nsw-syd-w-blacktown",       label: "Blacktown & Mount Druitt",        state: "NSW", group: "Sydney West" },
  { id: "nsw-syd-w-penrith",         label: "Penrith & Surrounds",             state: "NSW", group: "Sydney West" },
  { id: "nsw-syd-w-castlehill",      label: "Castle Hill & Baulkham Hills",    state: "NSW", group: "Sydney West" },
  // Sydney South-West
  { id: "nsw-syd-sw-bankstown",      label: "Bankstown & Punchbowl",           state: "NSW", group: "Sydney South-West" },
  { id: "nsw-syd-sw-liverpool",      label: "Liverpool & Casula",              state: "NSW", group: "Sydney South-West" },
  { id: "nsw-syd-sw-fairfield",      label: "Fairfield & Cabramatta",          state: "NSW", group: "Sydney South-West" },
  { id: "nsw-syd-sw-campbelltown",   label: "Campbelltown & Surrounds",        state: "NSW", group: "Sydney South-West" },
  // Sydney South
  { id: "nsw-syd-s-hurstville",      label: "Hurstville & Kogarah",            state: "NSW", group: "Sydney South" },
  { id: "nsw-syd-s-sutherland",      label: "Sutherland & Miranda",            state: "NSW", group: "Sydney South" },
  { id: "nsw-syd-s-cronulla",        label: "Cronulla & Surrounds",            state: "NSW", group: "Sydney South" },
  // Other NSW (kept for now)
  { id: "nsw-newcastle",             label: "Newcastle & Hunter",              state: "NSW" },
  { id: "nsw-wollongong",            label: "Wollongong & Illawarra",          state: "NSW" },
  { id: "nsw-regional",              label: "NSW Regional",                    state: "NSW" },
  // ── VIC ──────────────────────────────────────────────────
  // Melbourne Inner
  { id: "vic-mel-i-cbd",             label: "Melbourne CBD & Docklands",       state: "VIC", group: "Melbourne Inner" },
  { id: "vic-mel-i-carlton",         label: "Carlton & Fitzroy",               state: "VIC", group: "Melbourne Inner" },
  { id: "vic-mel-i-richmond",        label: "Richmond & Collingwood",          state: "VIC", group: "Melbourne Inner" },
  { id: "vic-mel-i-southyarra",      label: "South Yarra & Prahran",           state: "VIC", group: "Melbourne Inner" },
  // Melbourne Inner North
  { id: "vic-mel-in-brunswick",      label: "Brunswick & Coburg",              state: "VIC", group: "Melbourne Inner North" },
  { id: "vic-mel-in-northcote",      label: "Northcote & Thornbury",           state: "VIC", group: "Melbourne Inner North" },
  { id: "vic-mel-in-preston",        label: "Preston & Reservoir",             state: "VIC", group: "Melbourne Inner North" },
  // Melbourne East
  { id: "vic-mel-e-hawthorn",        label: "Hawthorn & Camberwell",           state: "VIC", group: "Melbourne East" },
  { id: "vic-mel-e-boxhill",         label: "Box Hill & Doncaster",            state: "VIC", group: "Melbourne East" },
  { id: "vic-mel-e-ringwood",        label: "Ringwood & Bayswater",            state: "VIC", group: "Melbourne East" },
  // Melbourne South-East
  { id: "vic-mel-se-stkilda",        label: "St Kilda & Elwood",               state: "VIC", group: "Melbourne South-East" },
  { id: "vic-mel-se-caulfield",      label: "Caulfield & Bentleigh",           state: "VIC", group: "Melbourne South-East" },
  { id: "vic-mel-se-oakleigh",       label: "Oakleigh & Clayton",              state: "VIC", group: "Melbourne South-East" },
  { id: "vic-mel-se-dandenong",      label: "Dandenong & Surrounds",           state: "VIC", group: "Melbourne South-East" },
  // Melbourne Bayside
  { id: "vic-mel-b-brighton",        label: "Brighton & Hampton",              state: "VIC", group: "Melbourne Bayside" },
  { id: "vic-mel-b-cheltenham",      label: "Cheltenham & Mentone",            state: "VIC", group: "Melbourne Bayside" },
  { id: "vic-mel-b-frankston",       label: "Frankston & Surrounds",           state: "VIC", group: "Melbourne Bayside" },
  // Melbourne West
  { id: "vic-mel-w-footscray",       label: "Footscray & Yarraville",          state: "VIC", group: "Melbourne West" },
  { id: "vic-mel-w-sunshine",        label: "Sunshine & St Albans",            state: "VIC", group: "Melbourne West" },
  { id: "vic-mel-w-werribee",        label: "Werribee & Hoppers Crossing",     state: "VIC", group: "Melbourne West" },
  { id: "vic-mel-w-pointcook",       label: "Point Cook & Tarneit",            state: "VIC", group: "Melbourne West" },
  // Melbourne North
  { id: "vic-mel-n-essendon",        label: "Essendon & Moonee Ponds",         state: "VIC", group: "Melbourne North" },
  { id: "vic-mel-n-broadmeadows",    label: "Broadmeadows & Craigieburn",      state: "VIC", group: "Melbourne North" },
  { id: "vic-mel-n-epping",          label: "Epping & Mernda",                 state: "VIC", group: "Melbourne North" },
  // Other VIC (kept for now)
  { id: "vic-geelong",               label: "Geelong",                         state: "VIC" },
  { id: "vic-ballarat",              label: "Ballarat & Central Vic",          state: "VIC" },
  { id: "vic-regional",              label: "VIC Regional",                    state: "VIC" },
  // ── WA ───────────────────────────────────────────────────
  // Perth Inner
  { id: "wa-perth-i-cbd",            label: "Perth CBD & Northbridge",         state: "WA",  group: "Perth Inner" },
  { id: "wa-perth-i-subiaco",        label: "Subiaco & Leederville",           state: "WA",  group: "Perth Inner" },
  { id: "wa-perth-i-mtlawley",       label: "Mount Lawley & Highgate",         state: "WA",  group: "Perth Inner" },
  // Perth North
  { id: "wa-perth-n-joondalup",      label: "Joondalup & Hillarys",            state: "WA",  group: "Perth North" },
  { id: "wa-perth-n-stirling",       label: "Stirling & Innaloo",              state: "WA",  group: "Perth North" },
  { id: "wa-perth-n-wanneroo",       label: "Wanneroo & Yanchep",              state: "WA",  group: "Perth North" },
  { id: "wa-perth-n-mirrabooka",     label: "Mirrabooka & Balcatta",           state: "WA",  group: "Perth North" },
  // Perth South
  { id: "wa-perth-s-fremantle",      label: "Fremantle & East Fremantle",      state: "WA",  group: "Perth South" },
  { id: "wa-perth-s-cockburn",       label: "Cockburn & Bibra Lake",           state: "WA",  group: "Perth South" },
  { id: "wa-perth-s-rockingham",     label: "Rockingham & Baldivis",           state: "WA",  group: "Perth South" },
  { id: "wa-perth-s-mandurah",       label: "Mandurah & Surrounds",            state: "WA",  group: "Perth South" },
  // Perth East
  { id: "wa-perth-e-morley",         label: "Morley & Bayswater",              state: "WA",  group: "Perth East" },
  { id: "wa-perth-e-midland",        label: "Midland & Guildford",             state: "WA",  group: "Perth East" },
  { id: "wa-perth-e-belmont",        label: "Belmont & Cloverdale",            state: "WA",  group: "Perth East" },
  // Perth South-East
  { id: "wa-perth-se-cannington",    label: "Cannington & Riverton",           state: "WA",  group: "Perth South-East" },
  { id: "wa-perth-se-armadale",      label: "Armadale & Kelmscott",            state: "WA",  group: "Perth South-East" },
  { id: "wa-perth-se-gosnells",      label: "Gosnells & Thornlie",             state: "WA",  group: "Perth South-East" },
  // Perth Hills
  { id: "wa-perth-h-kalamunda",      label: "Kalamunda & Lesmurdie",           state: "WA",  group: "Perth Hills" },
  { id: "wa-perth-h-mundaring",      label: "Mundaring & Surrounds",           state: "WA",  group: "Perth Hills" },
  // Other WA (kept for now)
  { id: "wa-regional-south",         label: "Regional WA — South",             state: "WA"  },
  { id: "wa-regional-north",         label: "Regional WA — North",             state: "WA"  },
  // ── SA ───────────────────────────────────────────────────
  // Adelaide Inner
  { id: "sa-adel-i-cbd",             label: "Adelaide CBD & North Adelaide",   state: "SA",  group: "Adelaide Inner" },
  { id: "sa-adel-i-norwood",         label: "Norwood & Kent Town",             state: "SA",  group: "Adelaide Inner" },
  { id: "sa-adel-i-unley",           label: "Unley & Hyde Park",               state: "SA",  group: "Adelaide Inner" },
  // Adelaide North
  { id: "sa-adel-n-prospect",        label: "Prospect & Walkerville",          state: "SA",  group: "Adelaide North" },
  { id: "sa-adel-n-modbury",         label: "Modbury & Tea Tree Gully",        state: "SA",  group: "Adelaide North" },
  { id: "sa-adel-n-salisbury",       label: "Salisbury & Surrounds",           state: "SA",  group: "Adelaide North" },
  { id: "sa-adel-n-elizabeth",       label: "Elizabeth & Smithfield",          state: "SA",  group: "Adelaide North" },
  // Adelaide South
  { id: "sa-adel-s-glenelg",         label: "Glenelg & Brighton",              state: "SA",  group: "Adelaide South" },
  { id: "sa-adel-s-marion",          label: "Marion & Mitcham",                state: "SA",  group: "Adelaide South" },
  { id: "sa-adel-s-noarlunga",       label: "Noarlunga & Christies Beach",     state: "SA",  group: "Adelaide South" },
  { id: "sa-adel-s-aldinga",         label: "Aldinga & Sellicks Beach",        state: "SA",  group: "Adelaide South" },
  // Adelaide East
  { id: "sa-adel-e-burnside",        label: "Burnside & Magill",               state: "SA",  group: "Adelaide East" },
  { id: "sa-adel-e-stirling",        label: "Stirling & Adelaide Hills",       state: "SA",  group: "Adelaide East" },
  // Adelaide West
  { id: "sa-adel-w-westlakes",       label: "West Lakes & Henley Beach",       state: "SA",  group: "Adelaide West" },
  { id: "sa-adel-w-portadel",        label: "Port Adelaide & Semaphore",       state: "SA",  group: "Adelaide West" },
  // Other SA (kept for now)
  { id: "sa-regional",               label: "SA Regional",                     state: "SA"  },
  // ── ACT ──────────────────────────────────────────────────
  { id: "act-canberra-central",      label: "Canberra Central (Civic & City)", state: "ACT" },
  { id: "act-canberra-i-north",      label: "Inner North (Braddon & Dickson)", state: "ACT" },
  { id: "act-canberra-i-south",      label: "Inner South (Kingston & Manuka)", state: "ACT" },
  { id: "act-belconnen",             label: "Belconnen",                       state: "ACT" },
  { id: "act-woden",                 label: "Woden & Weston",                  state: "ACT" },
  { id: "act-tuggeranong",           label: "Tuggeranong",                     state: "ACT" },
  { id: "act-gungahlin",             label: "Gungahlin",                       state: "ACT" },
  // ── TAS ──────────────────────────────────────────────────
  { id: "tas-hob-cbd",               label: "Hobart CBD & North Hobart",       state: "TAS", group: "Hobart" },
  { id: "tas-hob-sandybay",          label: "Sandy Bay & Battery Point",       state: "TAS", group: "Hobart" },
  { id: "tas-hob-glenorchy",         label: "Glenorchy & Surrounds",           state: "TAS", group: "Hobart" },
  { id: "tas-hob-kingston",          label: "Kingston & Blackmans Bay",        state: "TAS", group: "Hobart" },
  { id: "tas-hob-eastern",           label: "Eastern Shore (Bellerive & Howrah)",state:"TAS",group: "Hobart" },
  // Other TAS (kept for now)
  { id: "tas-launceston",            label: "Launceston",                      state: "TAS" },
  { id: "tas-regional",              label: "TAS Regional",                    state: "TAS" },
  // ── NT ───────────────────────────────────────────────────
  { id: "nt-darwin-cbd",             label: "Darwin CBD & Stuart Park",        state: "NT" },
  { id: "nt-darwin-north",           label: "Northern Suburbs (Casuarina & Nightcliff)", state: "NT" },
  { id: "nt-darwin-palmerston",      label: "Palmerston & Surrounds",          state: "NT" },
  { id: "nt-darwin-outer",           label: "Outer Darwin (Howard Springs & Humpty Doo)",state: "NT" },
  { id: "nt-alice-springs",          label: "Alice Springs",                   state: "NT" },
];

// ─── Benchmark base data — seeded realistic values per zone ───────────────
// Hourly rates reflect typical Uber Eats / DoorDash earnings in each area.
// Scores reflect zone density, order frequency, and typical driver efficiency.
// When Firebase connects, replace getRegionBenchmark() with live Firestore aggregates.
const REGION_BASE = {
  // ── QLD ──────────────────────────────────────────────────
  // Greater Brisbane North
  "qld-bne-n-caboolture":      { hourly: 28.4, perDel: 11.6, score: 92  },
  "qld-bne-n-northlakes":      { hourly: 29.6, perDel: 12.0, score: 95  },
  "qld-bne-n-stafford":        { hourly: 30.2, perDel: 12.3, score: 97  },
  "qld-bne-n-albanycreek":     { hourly: 28.9, perDel: 11.8, score: 93  },
  "qld-bne-n-chermside":       { hourly: 30.8, perDel: 12.4, score: 98  },
  // Brisbane Inner
  "qld-bne-i-cbd":             { hourly: 33.2, perDel: 13.5, score: 107 },
  "qld-bne-i-southbris":       { hourly: 32.4, perDel: 13.2, score: 105 },
  // Brisbane East
  "qld-bne-e-cannonhill":      { hourly: 30.6, perDel: 12.5, score: 99  },
  "qld-bne-e-wynnum":          { hourly: 28.7, perDel: 11.7, score: 92  },
  "qld-bne-e-cleveland":       { hourly: 27.4, perDel: 11.3, score: 89  },
  // Brisbane South
  "qld-bne-s-tarragindi":      { hourly: 30.1, perDel: 12.3, score: 97  },
  "qld-bne-s-sunnybank":       { hourly: 31.5, perDel: 12.8, score: 101 },
  "qld-bne-s-logan":           { hourly: 28.6, perDel: 11.7, score: 92  },
  "qld-bne-s-beenleigh":       { hourly: 27.3, perDel: 11.2, score: 88  },
  // Brisbane West
  "qld-bne-w-indooroopilly":   { hourly: 30.4, perDel: 12.4, score: 98  },
  "qld-bne-w-kenmore":         { hourly: 28.5, perDel: 11.7, score: 92  },
  // Ipswich Region
  "qld-ipswich-central":       { hourly: 26.8, perDel: 11.1, score: 87  },
  "qld-ipswich-springfield":   { hourly: 27.6, perDel: 11.4, score: 90  },
  // Gold Coast North
  "qld-gc-n-coomera":          { hourly: 28.9, perDel: 11.8, score: 94  },
  "qld-gc-n-helensvale":       { hourly: 29.4, perDel: 12.0, score: 96  },
  // Gold Coast Central
  "qld-gc-c-southport":        { hourly: 30.7, perDel: 12.5, score: 99  },
  "qld-gc-c-surfers":          { hourly: 32.6, perDel: 13.2, score: 105 },
  "qld-gc-c-nerang":           { hourly: 28.4, perDel: 11.6, score: 92  },
  // Gold Coast South
  "qld-gc-s-broadbeach":       { hourly: 31.8, perDel: 12.9, score: 102 },
  "qld-gc-s-burleigh":         { hourly: 30.5, perDel: 12.4, score: 98  },
  "qld-gc-s-robina":           { hourly: 29.2, perDel: 11.9, score: 95  },
  // Gold Coast Far South
  "qld-gc-fs-palmbeach":       { hourly: 28.7, perDel: 11.7, score: 92  },
  // Darling Downs
  "qld-dd-toowoomba":          { hourly: 25.4, perDel: 10.7, score: 84  },
  // Other QLD
  "qld-sunshine-coast":        { hourly: 27.8, perDel: 11.6, score: 92  },
  "qld-regional-central":      { hourly: 24.2, perDel: 10.6, score: 83  },
  "qld-regional-north":        { hourly: 23.8, perDel: 10.4, score: 81  },

  // ── NSW ──────────────────────────────────────────────────
  // Sydney Inner
  "nsw-syd-i-cbd":             { hourly: 35.8, perDel: 14.2, score: 112 },
  "nsw-syd-i-pyrmont":         { hourly: 34.6, perDel: 13.8, score: 109 },
  "nsw-syd-i-newtown":         { hourly: 33.4, perDel: 13.5, score: 106 },
  // Sydney East
  "nsw-syd-e-bondi":           { hourly: 34.9, perDel: 13.9, score: 110 },
  "nsw-syd-e-doublebay":       { hourly: 33.8, perDel: 13.6, score: 107 },
  "nsw-syd-e-randwick":        { hourly: 32.5, perDel: 13.2, score: 104 },
  "nsw-syd-e-maroubra":        { hourly: 31.6, perDel: 12.9, score: 102 },
  // Sydney North
  "nsw-syd-n-northsydney":     { hourly: 33.1, perDel: 13.4, score: 105 },
  "nsw-syd-n-chatswood":       { hourly: 31.8, perDel: 13.0, score: 102 },
  "nsw-syd-n-hornsby":         { hourly: 29.6, perDel: 12.1, score: 96  },
  // Sydney Northern Beaches
  "nsw-syd-nb-manly":          { hourly: 32.4, perDel: 13.2, score: 104 },
  "nsw-syd-nb-brookvale":      { hourly: 30.5, perDel: 12.5, score: 98  },
  "nsw-syd-nb-monavale":       { hourly: 28.9, perDel: 11.9, score: 94  },
  // Sydney Inner West
  "nsw-syd-iw-marrickville":   { hourly: 32.6, perDel: 13.2, score: 104 },
  "nsw-syd-iw-burwood":        { hourly: 30.7, perDel: 12.5, score: 98  },
  "nsw-syd-iw-ashfield":       { hourly: 31.2, perDel: 12.7, score: 100 },
  // Sydney West
  "nsw-syd-w-parramatta":      { hourly: 30.8, perDel: 12.5, score: 99  },
  "nsw-syd-w-blacktown":       { hourly: 28.4, perDel: 11.7, score: 92  },
  "nsw-syd-w-penrith":         { hourly: 27.2, perDel: 11.3, score: 89  },
  "nsw-syd-w-castlehill":      { hourly: 29.5, perDel: 12.1, score: 95  },
  // Sydney South-West
  "nsw-syd-sw-bankstown":      { hourly: 28.6, perDel: 11.8, score: 93  },
  "nsw-syd-sw-liverpool":      { hourly: 27.8, perDel: 11.5, score: 91  },
  "nsw-syd-sw-fairfield":      { hourly: 28.2, perDel: 11.6, score: 92  },
  "nsw-syd-sw-campbelltown":   { hourly: 26.9, perDel: 11.2, score: 88  },
  // Sydney South
  "nsw-syd-s-hurstville":      { hourly: 30.2, perDel: 12.3, score: 97  },
  "nsw-syd-s-sutherland":      { hourly: 29.4, perDel: 12.0, score: 95  },
  "nsw-syd-s-cronulla":        { hourly: 28.8, perDel: 11.8, score: 93  },
  // Other NSW
  "nsw-newcastle":             { hourly: 27.6, perDel: 11.5, score: 91  },
  "nsw-wollongong":            { hourly: 26.8, perDel: 11.2, score: 89  },
  "nsw-regional":              { hourly: 25.0, perDel: 10.7, score: 85  },

  // ── VIC ──────────────────────────────────────────────────
  // Melbourne Inner
  "vic-mel-i-cbd":             { hourly: 34.2, perDel: 13.8, score: 108 },
  "vic-mel-i-carlton":         { hourly: 32.8, perDel: 13.3, score: 105 },
  "vic-mel-i-richmond":        { hourly: 33.5, perDel: 13.5, score: 106 },
  "vic-mel-i-southyarra":      { hourly: 33.1, perDel: 13.4, score: 105 },
  // Melbourne Inner North
  "vic-mel-in-brunswick":      { hourly: 31.6, perDel: 12.9, score: 102 },
  "vic-mel-in-northcote":      { hourly: 30.4, perDel: 12.4, score: 98  },
  "vic-mel-in-preston":        { hourly: 28.7, perDel: 11.8, score: 93  },
  // Melbourne East
  "vic-mel-e-hawthorn":        { hourly: 31.2, perDel: 12.7, score: 100 },
  "vic-mel-e-boxhill":         { hourly: 29.8, perDel: 12.2, score: 96  },
  "vic-mel-e-ringwood":        { hourly: 28.2, perDel: 11.6, score: 91  },
  // Melbourne South-East
  "vic-mel-se-stkilda":        { hourly: 32.4, perDel: 13.1, score: 103 },
  "vic-mel-se-caulfield":      { hourly: 30.1, perDel: 12.3, score: 97  },
  "vic-mel-se-oakleigh":       { hourly: 28.9, perDel: 11.9, score: 94  },
  "vic-mel-se-dandenong":      { hourly: 27.6, perDel: 11.4, score: 91  },
  // Melbourne Bayside
  "vic-mel-b-brighton":        { hourly: 30.6, perDel: 12.5, score: 99  },
  "vic-mel-b-cheltenham":      { hourly: 29.2, perDel: 11.9, score: 95  },
  "vic-mel-b-frankston":       { hourly: 27.4, perDel: 11.3, score: 90  },
  // Melbourne West
  "vic-mel-w-footscray":       { hourly: 30.5, perDel: 12.4, score: 98  },
  "vic-mel-w-sunshine":        { hourly: 28.3, perDel: 11.6, score: 92  },
  "vic-mel-w-werribee":        { hourly: 27.1, perDel: 11.2, score: 89  },
  "vic-mel-w-pointcook":       { hourly: 28.7, perDel: 11.8, score: 93  },
  // Melbourne North
  "vic-mel-n-essendon":        { hourly: 29.4, perDel: 12.0, score: 95  },
  "vic-mel-n-broadmeadows":    { hourly: 27.5, perDel: 11.3, score: 90  },
  "vic-mel-n-epping":          { hourly: 28.6, perDel: 11.7, score: 92  },
  // Other VIC
  "vic-geelong":               { hourly: 26.5, perDel: 11.1, score: 88  },
  "vic-ballarat":              { hourly: 25.2, perDel: 10.8, score: 85  },
  "vic-regional":              { hourly: 24.0, perDel: 10.4, score: 82  },

  // ── WA ───────────────────────────────────────────────────
  // Perth Inner
  "wa-perth-i-cbd":            { hourly: 32.5, perDel: 13.2, score: 104 },
  "wa-perth-i-subiaco":        { hourly: 31.2, perDel: 12.7, score: 100 },
  "wa-perth-i-mtlawley":       { hourly: 30.6, perDel: 12.5, score: 98  },
  // Perth North
  "wa-perth-n-joondalup":      { hourly: 29.8, perDel: 12.2, score: 96  },
  "wa-perth-n-stirling":       { hourly: 30.1, perDel: 12.3, score: 97  },
  "wa-perth-n-wanneroo":       { hourly: 27.4, perDel: 11.3, score: 90  },
  "wa-perth-n-mirrabooka":     { hourly: 28.7, perDel: 11.8, score: 93  },
  // Perth South
  "wa-perth-s-fremantle":      { hourly: 30.4, perDel: 12.4, score: 98  },
  "wa-perth-s-cockburn":       { hourly: 28.9, perDel: 11.8, score: 94  },
  "wa-perth-s-rockingham":     { hourly: 27.5, perDel: 11.3, score: 90  },
  "wa-perth-s-mandurah":       { hourly: 26.2, perDel: 10.9, score: 86  },
  // Perth East
  "wa-perth-e-morley":         { hourly: 29.2, perDel: 11.9, score: 95  },
  "wa-perth-e-midland":        { hourly: 27.8, perDel: 11.5, score: 92  },
  "wa-perth-e-belmont":        { hourly: 28.4, perDel: 11.7, score: 93  },
  // Perth South-East
  "wa-perth-se-cannington":    { hourly: 28.6, perDel: 11.7, score: 93  },
  "wa-perth-se-armadale":      { hourly: 26.4, perDel: 10.9, score: 87  },
  "wa-perth-se-gosnells":      { hourly: 27.1, perDel: 11.2, score: 89  },
  // Perth Hills
  "wa-perth-h-kalamunda":      { hourly: 25.8, perDel: 10.8, score: 86  },
  "wa-perth-h-mundaring":      { hourly: 24.6, perDel: 10.5, score: 83  },
  // Other WA
  "wa-regional-south":         { hourly: 24.4, perDel: 10.5, score: 83  },
  "wa-regional-north":         { hourly: 23.2, perDel: 10.1, score: 79  },

  // ── SA ───────────────────────────────────────────────────
  // Adelaide Inner
  "sa-adel-i-cbd":             { hourly: 30.8, perDel: 12.5, score: 99  },
  "sa-adel-i-norwood":         { hourly: 29.6, perDel: 12.1, score: 96  },
  "sa-adel-i-unley":           { hourly: 29.2, perDel: 12.0, score: 95  },
  // Adelaide North
  "sa-adel-n-prospect":        { hourly: 28.4, perDel: 11.7, score: 93  },
  "sa-adel-n-modbury":         { hourly: 27.5, perDel: 11.3, score: 90  },
  "sa-adel-n-salisbury":       { hourly: 26.8, perDel: 11.1, score: 88  },
  "sa-adel-n-elizabeth":       { hourly: 26.2, perDel: 10.9, score: 87  },
  // Adelaide South
  "sa-adel-s-glenelg":         { hourly: 29.4, perDel: 12.0, score: 95  },
  "sa-adel-s-marion":          { hourly: 28.1, perDel: 11.5, score: 92  },
  "sa-adel-s-noarlunga":       { hourly: 26.5, perDel: 11.0, score: 87  },
  "sa-adel-s-aldinga":         { hourly: 25.1, perDel: 10.6, score: 84  },
  // Adelaide East
  "sa-adel-e-burnside":        { hourly: 28.7, perDel: 11.8, score: 93  },
  "sa-adel-e-stirling":        { hourly: 25.4, perDel: 10.7, score: 85  },
  // Adelaide West
  "sa-adel-w-westlakes":       { hourly: 27.6, perDel: 11.4, score: 91  },
  "sa-adel-w-portadel":        { hourly: 26.9, perDel: 11.1, score: 89  },
  // Other SA
  "sa-regional":               { hourly: 23.5, perDel: 10.2, score: 80  },

  // ── ACT ──────────────────────────────────────────────────
  "act-canberra-central":      { hourly: 31.8, perDel: 12.9, score: 102 },
  "act-canberra-i-north":      { hourly: 30.4, perDel: 12.4, score: 98  },
  "act-canberra-i-south":      { hourly: 30.1, perDel: 12.3, score: 97  },
  "act-belconnen":             { hourly: 28.9, perDel: 11.8, score: 94  },
  "act-woden":                 { hourly: 28.2, perDel: 11.6, score: 92  },
  "act-tuggeranong":           { hourly: 27.4, perDel: 11.3, score: 90  },
  "act-gungahlin":             { hourly: 27.8, perDel: 11.5, score: 91  },

  // ── TAS ──────────────────────────────────────────────────
  "tas-hob-cbd":               { hourly: 28.1, perDel: 11.6, score: 92  },
  "tas-hob-sandybay":          { hourly: 27.4, perDel: 11.3, score: 90  },
  "tas-hob-glenorchy":         { hourly: 26.2, perDel: 10.9, score: 87  },
  "tas-hob-kingston":          { hourly: 25.8, perDel: 10.8, score: 86  },
  "tas-hob-eastern":           { hourly: 26.5, perDel: 11.0, score: 87  },
  "tas-launceston":            { hourly: 25.4, perDel: 10.8, score: 86  },
  "tas-regional":              { hourly: 23.0, perDel: 10.0, score: 78  },

  // ── NT ───────────────────────────────────────────────────
  "nt-darwin-cbd":             { hourly: 28.4, perDel: 11.7, score: 92  },
  "nt-darwin-north":           { hourly: 26.9, perDel: 11.2, score: 88  },
  "nt-darwin-palmerston":      { hourly: 26.2, perDel: 10.9, score: 87  },
  "nt-darwin-outer":           { hourly: 25.1, perDel: 10.5, score: 84  },
  "nt-alice-springs":          { hourly: 24.6, perDel: 10.6, score: 83  },
};

// ─────────────────────────────────────────────────────────────────────────────
// BENCHMARK ELIGIBILITY RULE (for future Firebase integration)
//
// When regional benchmarks are powered by live Firestore data, a shift should
// only be counted if the driver's online time was 60 minutes or more. This
// prevents short or incomplete shifts from skewing community averages.
//
// The constant below is the single place to change that threshold.
// Apply it both when writing a shift to Firestore and when querying aggregates.
// ─────────────────────────────────────────────────────────────────────────────
const BENCHMARK_MIN_ONLINE_MINS = 60;

function getRegionBenchmark(regionId) {
  const base = REGION_BASE[regionId];
  if (!base) return null;
  const weekNum = Math.floor(Date.now() / (7 * 24 * 60 * 60 * 1000));
  const seed = (weekNum * 31 + regionId.length * 7) % 17;
  const v = (seed - 8) * 0.3;
  // Seeded shift count — varies week to week between ~18 and ~74 per region
  const shiftSeed = (weekNum * 13 + regionId.length * 11) % 57;
  const shifts = 18 + shiftSeed;
  return {
    hourly: Math.max(0, base.hourly + v).toFixed(2),
    perDel: Math.max(0, base.perDel + v * 0.3).toFixed(2),
    score:  Math.max(0, base.score  + v * 2).toFixed(1),
    shifts,
  };
}
// ─────────────────────────────────────────────
// When you have a Firebase project, add the SDK and swap the DB
// abstraction below to use Firestore instead of localStorage.
// ─────────────────────────────────────────────

// ─── Storage abstraction ───
// Swap these functions to Firestore when Firebase is connected
const DB = {
  get: (key) => { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } },
  set: (key, val) => localStorage.setItem(key, JSON.stringify(val)),
  remove: (key) => localStorage.removeItem(key),
};

// ─── Helpers ───
const cap = (v, max) => Math.min(v, max);
const fmt$ = (n) => "$" + (n || 0).toFixed(2);
const fmtPct = (n) => (n || 0).toFixed(1) + "%";
const scoreColor = (s) => s < 80 ? "var(--red)" : s < 100 ? "var(--amber)" : s < 120 ? "#86efac" : "var(--green)";
const scoreClass = (s) => s < 80 ? "score-red" : s < 100 ? "score-yellow" : s < 120 ? "score-green" : "score-strong";

function getFYBounds() {
  const now = new Date();
  const y = now.getFullYear();
  const fyStart = now >= new Date(y, 6, 1) ? new Date(y, 6, 1) : new Date(y - 1, 6, 1);
  const fyEnd = new Date(fyStart.getFullYear() + 1, 6, 1);
  return { fyStart, fyEnd };
}

function getWeekBounds() {
  const now = new Date();
  const day = now.getDay(); // 0=Sun
  const mon = new Date(now);
  mon.setDate(now.getDate() - (day === 0 ? 6 : day - 1));
  mon.setHours(0, 0, 0, 0);
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 7);
  return { weekStart: mon, weekEnd: sun };
}

function filterTrips(trips, period) {
  const now = new Date();
  if (period === "lifetime") return trips;
  if (period === "fy") {
    const { fyStart, fyEnd } = getFYBounds();
    return trips.filter(t => { const d = new Date(t.ts); return d >= fyStart && d < fyEnd; });
  }
  if (period === "ytd") {
    const { fyStart } = getFYBounds();
    return trips.filter(t => new Date(t.ts) >= fyStart && new Date(t.ts) <= now);
  }
  if (period === "monthly") {
    return trips.filter(t => { const d = new Date(t.ts); return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear(); });
  }
  if (period === "weekly") {
    const { weekStart, weekEnd } = getWeekBounds();
    return trips.filter(t => { const d = new Date(t.ts); return d >= weekStart && d < weekEnd; });
  }
  return trips;
}

function computeStats(trips, kmPref) {
  const n = trips.length;
  if (!n) return null;
  const totalEarned = trips.reduce((s, t) => s + t.totalEarned, 0);
  const totalHrs    = trips.reduce((s, t) => s + t.totalHrs, 0);
  const totalKm     = trips.reduce((s, t) => s + t.totalKm, 0);
  const activeKm    = trips.reduce((s, t) => s + t.kmDel, 0);
  const totalDels   = trips.reduce((s, t) => s + t.dels, 0);
  const totalExp    = trips.reduce((s, t) => s + (t.expenses || 0), 0);
  const avgScore    = trips.reduce((s, t) => s + t.score, 0) / n;
  const bestScore   = Math.max(...trips.map(t => t.score));
  const deductKm    = totalKm;
  const deduction   = Math.min(deductKm, ATO_KM_CAP) * ATO_RATE_PER_KM;
  const daysSet     = new Set(trips.map(t => new Date(t.ts).toDateString()));
  return { n, totalEarned, totalHrs, totalKm, activeKm, totalDels, totalExp, avgScore, bestScore, deductKm, deduction, daysWorked: daysSet.size };
}

function computeTrip(inputs, targets = DEFAULT_TARGETS) {
  const { base, tip, bonus, tDel, tWait, activeMin, activeKmInput, kmDel, kmWait, dels, expenses } = inputs;
  const totalEarned = (base||0) + (tip||0) + (bonus||0);
  const totalMin    = (tDel||0) + (tWait||0);
  const totalHrs    = totalMin / 60;
  const totalKm     = (kmDel||0) + (kmWait||0);
  const hourly      = totalHrs > 0 ? totalEarned / totalHrs : 0;
  const perDel      = dels > 0 ? totalEarned / dels : 0;
  const perKm       = totalKm > 0 ? (totalEarned / totalKm) * 100 : 0;
  const activeMins  = activeMin != null ? (activeMin||0) : null;
  const active      = (activeMins != null && totalMin > 0) ? (activeMins / totalMin) * 100 : 0;

  const hasActiveKm = activeKmInput != null && activeKmInput > 0;
  const activeKmPct = hasActiveKm && totalKm > 0 ? (activeKmInput / totalKm) * 100 : null;
  const kmPerDel    = dels > 0 ? totalKm / dels : 0;

  const ratioH = cap(hourly / (targets.hourly || DEFAULT_TARGETS.hourly), SCORE_CAP);
  const ratioD = cap(perDel / (targets.perDel || DEFAULT_TARGETS.perDel), SCORE_CAP);
  const ratioK = hasActiveKm && activeKmPct != null ? cap(activeKmPct / (targets.activeKm || DEFAULT_TARGETS.activeKm), SCORE_CAP) : null;
  const ratioA = activeMins != null && totalMin > 0 ? cap(active / (targets.activeTime || DEFAULT_TARGETS.activeTime), SCORE_CAP) : null;

  const ratios = [ratioH, ratioD, ratioK, ratioA].filter(r => r !== null);
  const score  = ratios.length > 0 ? (ratios.reduce((a, b) => a + b, 0) / ratios.length) * 100 : 0;

  return { totalEarned, totalMin, totalHrs, totalKm, hourly, perDel, perKm, active, activeMins, activeKmPct, hasActiveKm, kmPerDel, ratioH, ratioD, ratioK, ratioA, score };
}

// ─── SEED SHIFTS ───
// Hardcoded shifts merged into trips on app boot (if not already present, matched by id).
// Delete entries from this array before launch.
const SEED_SHIFTS = (() => {
  const makeSeed = ({ id, ts, base, tip, bonus, onlineMin, activeMin, totalKm, activeKm, dels, platform }) => {
    const inputs = {
      base, tip, bonus,
      tDel: onlineMin, tWait: 0,
      activeMin, activeKmInput: activeKm,
      kmDel: totalKm, kmWait: 0,
      dels, expenses: 0,
    };
    const c = computeTrip(inputs);
    return {
      id, ts,
      activeMins: activeMin,
      activeKm,
      platform,
      ...inputs, ...c,
      deduction: totalKm * ATO_RATE_PER_KM,
      __seed: true,
    };
  };

  return [
    makeSeed({
      id: 1748083320000,
      ts: "2026-05-24T15:22:00.000+10:00",
      base: 36.48,
      tip: 0,
      bonus: 30,
      onlineMin: 72,
      activeMin: 70,
      totalKm: 40.5,
      activeKm: 23.76,
      dels: 3,
      platform: "uber_eats",
    }),
    makeSeed({
      id: 1767435480000,
      ts: "2026-01-03T21:18:00+11:00",
      base: 29.26,
      tip: 0,
      bonus: 0,
      onlineMin: 100,
      activeMin: 32,
      totalKm: 56.25,
      activeKm: 36.12,
      dels: 4,
      platform: "doordash",
    }),
    makeSeed({
      id: 1767531480000,
      ts: "2026-01-04T23:58:00+11:00",
      base: 8.27,
      tip: 0,
      bonus: 0,
      onlineMin: 61,
      activeMin: 9,
      totalKm: 59.55,
      activeKm: 5.28,
      dels: 1,
      platform: "doordash",
    }),
    makeSeed({
      id: 1767602100000,
      ts: "2026-01-05T19:35:00+11:00",
      base: 11.12,
      tip: 0,
      bonus: 0,
      onlineMin: 34,
      activeMin: 20,
      totalKm: 9.15,
      activeKm: 6.6,
      dels: 2,
      platform: "doordash",
    }),
    makeSeed({
      id: 1768032000000,
      ts: "2026-01-10T19:00:00+11:00",
      base: 7.27,
      tip: 0,
      bonus: 30,
      onlineMin: 15,
      activeMin: 14,
      totalKm: 7.5,
      activeKm: 4.68,
      dels: 1,
      platform: "uber_eats",
    }),
    makeSeed({
      id: 1768036500000,
      ts: "2026-01-10T20:15:00+11:00",
      base: 14.42,
      tip: 0,
      bonus: 0,
      onlineMin: 85,
      activeMin: 18,
      totalKm: 37.8,
      activeKm: 9.12,
      dels: 2,
      platform: "doordash",
    }),
    makeSeed({
      id: 1768095900000,
      ts: "2026-01-11T12:45:00+11:00",
      base: 40.45,
      tip: 0,
      bonus: 20,
      onlineMin: 122,
      activeMin: 76,
      totalKm: 66.9,
      activeKm: 45.0,
      dels: 5,
      platform: "uber_eats",
    }),
    makeSeed({
      id: 1780783500000,
      ts: "2026-06-07T08:05:00+10:00",
      base: 11.91,
      tip: 0,
      bonus: 0,
      onlineMin: 25,
      activeMin: 22,
      totalKm: 14.85,
      activeKm: 10.44,
      dels: 2,
      platform: "doordash",
    }),
  ];
})();

// ─── CSS ───
const css = `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&family=Geist+Mono:wght@400;500;600;700&display=swap');

*{box-sizing:border-box;margin:0;padding:0;}
:root{
  --bg:#FAFAFA;
  --surface:#FFFFFF;
  --elevated:#F4F4F6;
  --border:rgba(0,0,0,.08);
  --border2:rgba(0,0,0,.15);
  --text:#000000;
  --muted:#6E6E73;
  --muted2:#98989D;
  --green:#008F44;
  --green-dim:rgba(0,143,68,.1);
  --green-border:rgba(0,143,68,.25);
  --blue:#0A84FF;
  --blue-dim:rgba(10,132,255,.1);
  --blue-border:rgba(10,132,255,.25);
  --amber:#FF9500;
  --amber-dim:rgba(255,149,0,.1);
  --amber-border:rgba(255,149,0,.25);
  --red:#FF453A;
  --red-dim:rgba(255,69,58,.1);
  --red-border:rgba(255,69,58,.25);
  --purple:#AF52DE;
  --purple-dim:rgba(175,82,222,.1);
  --purple-border:rgba(175,82,222,.25);
  --grad:linear-gradient(90deg,#008F44,#0A84FF);
  --r:14px;--rs:10px;--tr:0.18s cubic-bezier(.4,0,.2,1);
  --surface-grad:#FFFFFF;
  --elev-grad:#F4F4F6;
  --green-grad:linear-gradient(180deg, #00A050 0%, #008F44 100%);
  --green-arc-grad:linear-gradient(90deg, #008F44 0%, #00A050 100%);
  --hl-top:inset 0 1px 0 rgba(255,255,255,.5);
  --hl-top-strong:inset 0 1px 0 rgba(255,255,255,.8);
  --shadow-soft:0 1px 2px rgba(0,0,0,.04);
  --shadow-card:0 1px 2px rgba(0,0,0,.04);
  --shadow-green:0 4px 14px rgba(0,143,68,.3), inset 0 1px 0 rgba(255,255,255,.2);
  --nav-bg:rgba(250,250,250,.78);
  --picker-option:#FFFFFF;
  --picker-option-text:#000000;
}
[data-theme="dark"]{
  --bg:#0B0F14;
  --surface:#161B22;
  --elevated:#1F242D;
  --border:rgba(255,255,255,.08);
  --border2:rgba(255,255,255,.16);
  --text:#FFFFFF;
  --muted:#9BA3AF;
  --muted2:#6B7280;
  --green:#22C55E;
  --green-dim:rgba(34,197,94,.14);
  --green-border:rgba(34,197,94,.32);
  --blue:#3B82F6;
  --blue-dim:rgba(59,130,246,.14);
  --blue-border:rgba(59,130,246,.32);
  --amber:#F59E0B;
  --amber-dim:rgba(245,158,11,.14);
  --amber-border:rgba(245,158,11,.32);
  --red:#EF4444;
  --red-dim:rgba(239,68,68,.14);
  --red-border:rgba(239,68,68,.32);
  --purple:#A855F7;
  --purple-dim:rgba(168,85,247,.14);
  --purple-border:rgba(168,85,247,.32);
  --grad:linear-gradient(90deg,#22C55E,#3B82F6);
  --surface-grad:#161B22;
  --elev-grad:#1F242D;
  --green-grad:linear-gradient(180deg, #2DD46E 0%, #22C55E 100%);
  --green-arc-grad:linear-gradient(90deg, #22C55E 0%, #4ADE80 100%);
  --hl-top:inset 0 1px 0 rgba(255,255,255,.04);
  --hl-top-strong:inset 0 1px 0 rgba(255,255,255,.08);
  --shadow-soft:0 1px 3px rgba(0,0,0,.4);
  --shadow-card:0 1px 2px rgba(0,0,0,.4), inset 0 1px 0 rgba(255,255,255,.04);
  --shadow-green:0 4px 14px rgba(34,197,94,.3), inset 0 1px 0 rgba(255,255,255,.15);
  --nav-bg:rgba(11,15,20,.78);
  --picker-option:#1F242D;
  --picker-option-text:#FFFFFF;
}
html,body,#root{background:var(--bg) !important;color:var(--text) !important;transition:background .3s ease, color .3s ease;}
body{font-family:'Inter',system-ui,sans-serif;min-height:100vh;overflow-x:hidden;-webkit-font-smoothing:antialiased;font-variant-numeric:tabular-nums;letter-spacing:-.005em;}

/* Typography refinement — modern iOS feel */
h1,h2,h3,h4,.topbar-title,.gt-wordmark{letter-spacing:-.02em;}
.home-amount,.home-greeting,.timer-display,.timer-digits{letter-spacing:-.03em;}
[style*="fontWeight: \"700\""],[style*="fontWeight:\"700\""],[style*="fontWeight: \"800\""],[style*="fontWeight:\"800\""]{letter-spacing:-.015em;}
input,select,textarea{background:var(--surface) !important;color:var(--text) !important;font-variant-numeric:tabular-nums;border-color:var(--border) !important;}
input::placeholder{color:var(--muted2) !important;}
select option{background:var(--picker-option);color:var(--picker-option-text);}
input[type=number]{-moz-appearance:textfield;}
input[type=number]::-webkit-inner-spin-button,input[type=number]::-webkit-outer-spin-button{-webkit-appearance:none;}
::-webkit-scrollbar{width:3px;}
::-webkit-scrollbar-thumb{background:#2A3441;border-radius:2px;}

/* Views */
.view{display:none;min-height:100vh;flex-direction:column;background:var(--bg);color:var(--text);}
.view.active{display:flex;animation:fadeUp .2s ease;}
@keyframes fadeUp{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
@keyframes pulse{0%,100%{opacity:1;}50%{opacity:.35;}}
@keyframes spin{to{transform:rotate(360deg)}}

/* Topbar */
.topbar{display:flex;align-items:center;gap:12px;padding:14px 16px 12px;border-bottom:0.5px solid var(--border);background:var(--bg);position:sticky;top:0;z-index:50;}
.topbar-back{width:34px;height:34px;border-radius:var(--rs);background:var(--elevated);border:0.5px solid var(--border);color:var(--muted);cursor:pointer;font-size:16px;display:flex;align-items:center;justify-content:center;transition:all var(--tr);flex-shrink:0;}
.topbar-back:hover{border-color:var(--green);color:var(--green);}
.topbar-title{font-size:18px;font-weight:600;color:var(--text);}
.scroll-area{flex:1;overflow-y:auto;padding-bottom:80px;background:var(--bg);}

/* Buttons */
.btn{display:flex;align-items:center;justify-content:center;gap:8px;padding:14px 22px;border-radius:var(--r);font-family:'Inter',sans-serif;font-size:14px;font-weight:600;cursor:pointer;border:none;transition:all var(--tr);}
.btn-primary{background:var(--green-grad);color:#0B0F14;box-shadow:var(--shadow-green);}
.btn-primary:hover{background:#16a34a;}
.btn-outline{background:transparent;color:var(--text);border:0.5px solid var(--border2);}
.btn-outline:hover{border-color:var(--green);color:var(--green);}
.btn-danger{background:transparent;color:var(--red);border:0.5px solid var(--red-border);}
.btn-danger:hover{background:var(--red-dim);}
.btn-edit-style{background:transparent;color:var(--blue);border:0.5px solid var(--blue-border);}
.btn-edit-style:hover{background:var(--blue-dim);}
.btn-save{width:100%;padding:16px;background:var(--green-grad);color:#0B0F14;border:none;border-radius:var(--r);font-family:'Inter',sans-serif;font-size:15px;font-weight:700;cursor:pointer;transition:all var(--tr);box-shadow:var(--shadow-green);}
.btn-save:hover{background:#16a34a;}
.save-bar{position:fixed;bottom:0;left:0;right:0;padding:12px 16px 20px;background:linear-gradient(transparent,var(--bg) 35%);z-index:100;}
.val-msg{font-size:12px;color:var(--red);padding:10px 14px;background:var(--red-dim);border:0.5px solid var(--red-border);border-radius:var(--rs);margin-bottom:10px;display:none;}
.val-msg.show{display:block;}

/* GT Logo */
.gt-logo-wrap{display:flex;align-items:center;gap:9px;}
.gt-wordmark{font-size:18px;font-weight:700;letter-spacing:-.01em;line-height:1;}
.gt-wordmark-gig{color:var(--text);}
.gt-wordmark-track{color:#22C55E;}
.gt-logo-sm .gt-wordmark{font-size:14px;}

/* Setup */
.setup-wrap{display:flex;flex-direction:column;align-items:center;padding:48px 20px 80px;min-height:100vh;background:var(--bg);}
.setup-logo-row{display:flex;align-items:center;gap:12px;margin-bottom:8px;}
.setup-sub{font-size:13px;color:var(--muted);margin-bottom:36px;text-align:center;}
.setup-card{background:var(--surface);border:0.5px solid var(--border);border-radius:16px;padding:24px;width:100%;max-width:400px;}
.setup-step-label{font-size:10px;color:var(--green);letter-spacing:.12em;text-transform:uppercase;margin-bottom:6px;font-weight:600;}
.setup-step-title{font-size:22px;font-weight:700;margin-bottom:4px;color:var(--text);}
.setup-step-sub{font-size:13px;color:var(--muted);margin-bottom:24px;line-height:1.6;}
.setup-btns-row{display:flex;gap:10px;margin-top:20px;}
.setup-pill{display:flex;align-items:flex-start;gap:12px;padding:14px 16px;border-radius:10px;background:var(--elevated);border:1.5px solid var(--border);cursor:pointer;transition:all var(--tr);}
.setup-pill:hover,.setup-pill.selected{border-color:var(--green);background:var(--green-dim);}
.setup-pill-icon{font-size:20px;flex-shrink:0;margin-top:1px;}
.setup-pill-title{font-size:13px;font-weight:600;color:var(--text);}
.setup-pill-desc{font-size:11px;color:var(--muted);line-height:1.5;margin-top:2px;}
.setup-pill.recommended{position:relative;}
.setup-pill.recommended::after{content:'ATO RECOMMENDED';position:absolute;top:-8px;right:12px;font-size:8px;font-weight:700;letter-spacing:.1em;color:var(--green);background:var(--bg);padding:2px 6px;border-radius:4px;border:0.5px solid var(--green-border);}
.auth-divider{display:flex;align-items:center;gap:10px;margin:16px 0;color:var(--muted2);font-size:11px;}
.auth-divider::before,.auth-divider::after{content:'';flex:1;height:0.5px;background:var(--border);}
.social-btn{display:flex;align-items:center;justify-content:center;gap:10px;width:100%;padding:13px;border-radius:var(--rs);background:var(--elevated);border:0.5px solid var(--border);color:var(--text);font-size:13px;font-weight:500;cursor:pointer;transition:all var(--tr);margin-bottom:8px;}
.social-btn:hover{border-color:var(--border2);}
.social-icon{font-size:17px;}

/* Plan cards (onboarding) */
.plan-card{border-radius:16px;padding:20px;cursor:pointer;transition:all var(--tr);position:relative;overflow:hidden;}
.plan-card-pro{background:var(--green-dim);border:1.5px solid var(--green-border);}
.plan-card-free{background:var(--surface);border:1.5px solid var(--border);}
.plan-card:hover{transform:translateY(-1px);}
.plan-feature-row{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--muted);margin-bottom:5px;}
.plan-feature-row.active{color:var(--text);}
.plan-check{color:var(--green);flex-shrink:0;}
.plan-cross{color:var(--muted2);flex-shrink:0;}

/* Home screen */
.home-status-bar{background:var(--surface);border-bottom:0.5px solid var(--border);padding:12px 16px;display:flex;align-items:center;justify-content:space-between;}
.home-status-right{display:flex;align-items:center;gap:8px;}
.home-status-dot{width:6px;height:6px;border-radius:50%;background:var(--green);}
.home-status-plan{font-size:11px;color:var(--muted);font-weight:500;}
.home-hero{background:var(--surface);padding:22px 16px 18px;border-bottom:0.5px solid var(--border);}
.home-greeting{font-size:20px;color:var(--muted);margin-bottom:4px;font-weight:500;}
.home-amount{font-size:40px;font-weight:700;color:var(--text);letter-spacing:-0.02em;line-height:1;font-variant-numeric:tabular-nums;}
.home-amount-cents{font-size:24px;font-weight:400;color:var(--muted2);}
.home-amount-dollar{font-size:24px;font-weight:400;color:var(--muted2);margin-right:2px;}
.home-week-label{font-size:12px;color:var(--muted2);margin-top:4px;}
.home-change-pill{display:inline-flex;align-items:center;gap:4px;font-size:12px;font-weight:600;padding:4px 10px;border-radius:20px;margin-top:10px;}
.home-change-pill.up{color:var(--green);background:var(--green-dim);border:0.5px solid var(--green-border);}
.home-change-pill.down{color:var(--red);background:var(--red-dim);border:0.5px solid var(--red-border);}
.home-change-pill.flat{color:var(--muted);background:var(--elevated);border:0.5px solid var(--border);}
.home-cards{padding:12px;display:flex;flex-direction:column;gap:8px;}
.home-card{background:var(--surface-grad);border-radius:12px;border:0.5px solid var(--border);padding:14px 16px;box-shadow:var(--shadow-card);}
.home-card-label{font-size:11px;color:var(--muted);margin-bottom:5px;font-weight:500;letter-spacing:.03em;text-transform:uppercase;}
.home-card-val{font-size:22px;font-weight:700;color:var(--text);font-variant-numeric:tabular-nums;}
.home-card-sub{font-size:11px;color:var(--muted2);margin-top:3px;}
.home-card-row{display:flex;justify-content:space-between;align-items:center;}
.home-card-icon{width:36px;height:36px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:17px;flex-shrink:0;}
.home-icon-green{background:var(--green-dim);border:0.5px solid var(--green-border);}
.home-icon-blue{background:var(--blue-dim);border:0.5px solid var(--blue-border);}
.home-icon-amber{background:var(--amber-dim);border:0.5px solid var(--amber-border);}
.home-prog-bg{height:4px;background:var(--elevated);border-radius:2px;margin-top:10px;overflow:hidden;}
.home-prog{height:100%;border-radius:2px;background:var(--grad);transition:width .6s ease;}
.home-cards-2col{display:grid;grid-template-columns:1fr 1fr;gap:8px;}
.home-actions{padding:0 12px 16px;display:flex;flex-direction:column;gap:8px;}
.home-btn-log{background:var(--green-grad);border-radius:12px;padding:16px 18px;display:flex;align-items:center;justify-content:space-between;cursor:pointer;transition:all var(--tr);box-shadow:var(--shadow-green);}
.home-btn-log:hover{background:#16a34a;}
.home-btn-log-title{font-size:15px;font-weight:700;color:#0B0F14;}
.home-btn-log-sub{font-size:11px;color:rgba(11,15,20,.55);margin-top:2px;}
.home-btn-log-icon{font-size:22px;color:rgba(11,15,20,.4);}
.home-sec-row{display:grid;grid-template-columns:1fr 1fr;gap:8px;}
.home-btn-sec{background:var(--elevated);border:0.5px solid var(--border);border-radius:10px;padding:13px;font-size:12px;font-weight:600;color:var(--muted);text-align:center;cursor:pointer;transition:all var(--tr);}
.home-btn-sec:hover{border-color:var(--green);color:var(--green);}

/* Warning banner */
.warning-banner{background:var(--amber-dim);border-radius:14px;padding:12px 14px;display:flex;gap:10px;align-items:flex-start;margin-bottom:8px;}
.warning-banner-title{font-size:12px;font-weight:700;color:var(--amber);margin-bottom:2px;letter-spacing:-.01em;}
.warning-banner-text{font-size:11px;line-height:1.6;color:var(--muted);}

/* Log a Shift selection */
.log-shift-list{padding:14px;display:flex;flex-direction:column;gap:10px;}
.log-entry-card{background:var(--surface);border-radius:14px;border:0.5px solid var(--border);padding:16px;display:flex;align-items:center;gap:14px;cursor:pointer;transition:all var(--tr);position:relative;}
.log-entry-card:hover{border-color:var(--green);}
.log-entry-card.featured{border:1.5px solid var(--green);background:var(--green-dim);}
.log-entry-card.pro-card{border:1.5px solid var(--purple-border);}
.log-entry-card.pro-card:hover{border-color:var(--purple);}
.log-entry-icon{width:46px;height:46px;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0;}
.log-icon-dark{background:var(--green);font-size:20px;}
.log-icon-green{background:var(--green-dim);border:0.5px solid var(--green-border);}
.log-icon-blue{background:var(--blue-dim);border:0.5px solid var(--blue-border);}
.log-icon-gray{background:var(--elevated);border:0.5px solid var(--border);}
.log-entry-title{font-size:14px;font-weight:600;color:var(--text);margin-bottom:3px;}
.log-entry-desc{font-size:11px;color:var(--muted);line-height:1.5;}
.log-entry-arrow{font-size:18px;color:var(--muted2);flex-shrink:0;}
.log-pro-badge{font-size:9px;font-weight:700;color:var(--purple);background:var(--purple-dim);border:0.5px solid var(--purple-border);padding:2px 8px;border-radius:10px;white-space:nowrap;flex-shrink:0;letter-spacing:.04em;}
.log-lock-badge{font-size:9px;font-weight:600;color:var(--muted2);background:var(--elevated);border:0.5px solid var(--border);padding:2px 8px;border-radius:10px;white-space:nowrap;flex-shrink:0;}
.log-divider{display:flex;align-items:center;gap:10px;padding:2px 0;}
.log-divider-line{flex:1;height:0.5px;background:var(--border);}
.log-divider-label{font-size:10px;color:var(--muted2);letter-spacing:.08em;text-transform:uppercase;}

/* Sections */
.section{margin:12px 14px 0;background:var(--surface);border:0.5px solid var(--border);border-radius:12px;padding:16px;}
.section-label{font-size:10px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--muted2);margin-bottom:12px;}
.req{color:var(--red);margin-left:2px;}

/* Inputs */
.input-group{display:flex;flex-direction:column;gap:10px;}
.input-row{display:flex;flex-direction:column;gap:4px;}
.input-label{font-size:12px;color:var(--muted);letter-spacing:.02em;font-weight:500;}
.input-field{background:var(--elevated) !important;border:0.5px solid var(--border) !important;color:var(--text) !important;border-radius:var(--rs);padding:12px 14px;font-family:'Geist Mono',monospace;font-size:15px;outline:none;transition:border-color var(--tr);width:100%;font-variant-numeric:tabular-nums;}
.input-field:focus{border-color:var(--blue) !important;outline:none;}
.input-field::placeholder{color:var(--muted2) !important;}
.input-field.err{border-color:var(--red) !important;background:var(--red-dim) !important;}
.calc-row{display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-top:0.5px solid var(--border);margin-top:4px;}
.calc-label{font-size:12px;color:var(--muted);}
.calc-value{font-size:17px;font-weight:700;color:var(--text);font-variant-numeric:tabular-nums;}

/* Live metrics */
.metrics-panel{margin:12px 14px 0;background:var(--surface);border:0.5px solid var(--border);border-radius:12px;padding:16px;}
.metrics-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:12px;}
.metric-card{background:var(--elevated);border:0.5px solid var(--border);border-radius:var(--rs);padding:11px 13px;}
.metric-card-label{font-size:10px;color:var(--muted2);margin-bottom:3px;text-transform:uppercase;letter-spacing:.05em;font-weight:500;}
.metric-card-value{font-size:18px;font-weight:700;color:var(--text);font-variant-numeric:tabular-nums;}
.ratio-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:12px;}
.ratio-card{background:var(--elevated);border:0.5px solid var(--border);border-radius:var(--rs);padding:10px 12px;}
.ratio-card-label{font-size:9px;color:var(--muted2);letter-spacing:.06em;text-transform:uppercase;margin-bottom:4px;font-weight:500;}
.ratio-bar-bg{height:4px;background:var(--border);border-radius:2px;margin:5px 0 4px;overflow:hidden;}
.ratio-bar{height:100%;border-radius:2px;transition:width .4s ease;}
.ratio-value{font-size:13px;font-weight:700;font-variant-numeric:tabular-nums;}
.score-block{display:flex;align-items:center;justify-content:space-between;margin-top:12px;padding:16px 18px;border-radius:var(--rs);border:1.5px solid;}
.score-label{font-size:13px;font-weight:700;letter-spacing:.02em;}
.score-num{font-size:36px;font-weight:700;font-variant-numeric:tabular-nums;}
.score-red{border-color:var(--red-border);color:var(--red);background:var(--red-dim);}
.score-yellow{border-color:var(--amber-border);color:var(--amber);background:var(--amber-dim);}
.score-green{border-color:var(--green-border);color:var(--green);background:var(--green-dim);}
.score-strong{border-color:var(--green);color:var(--green);background:var(--green-dim);}

/* Deduction card */
.deduction-card{background:var(--green-dim);border:0.5px solid var(--green-border);border-radius:var(--rs);padding:14px 16px;margin-top:12px;display:flex;align-items:center;justify-content:space-between;}
.ded-label{font-size:10px;color:var(--green);letter-spacing:.08em;text-transform:uppercase;margin-bottom:2px;font-weight:600;}
.ded-value{font-size:22px;font-weight:700;color:var(--green);font-variant-numeric:tabular-nums;}
.ded-sub{font-size:10px;color:var(--muted);margin-top:2px;}
.ded-icon{font-size:26px;opacity:.7;}

/* Alert system */
.alert{padding:11px 14px;border-radius:var(--rs);display:flex;align-items:flex-start;gap:10px;font-size:12px;line-height:1.5;}
.alert-success{background:var(--green-dim);border:0.5px solid var(--green-border);color:var(--green);}
.alert-warning{background:var(--amber-dim);border:0.5px solid var(--amber-border);color:var(--amber);}
.alert-error{background:var(--red-dim);border:0.5px solid var(--red-border);color:var(--red);}
.alert-info{background:var(--blue-dim);border:0.5px solid var(--blue-border);color:var(--blue);}
.alert-icon{font-size:14px;flex-shrink:0;margin-top:1px;}
.alert-title{font-weight:700;margin-bottom:1px;}

/* Trip log */
.log-controls{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px;}
.sort-btn{padding:6px 14px;border-radius:20px;background:var(--elevated);border:0.5px solid var(--border);color:var(--muted);font-size:11px;font-weight:500;cursor:pointer;transition:all var(--tr);}
.sort-btn.active{border-color:var(--green);color:var(--green);background:var(--green-dim);}
.trip-card{background:var(--surface);border:0.5px solid var(--border);border-radius:12px;padding:14px 16px;margin-bottom:8px;cursor:pointer;transition:all var(--tr);}
.trip-card:hover{border-color:var(--green);}
.trip-card-top{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px;}
.trip-card-date{font-size:11px;color:var(--muted);}
.trip-card-score{font-size:22px;font-weight:700;text-align:right;font-variant-numeric:tabular-nums;}
.trip-card-score-label{font-size:9px;color:var(--muted2);text-align:right;letter-spacing:.05em;text-transform:uppercase;}
.trip-card-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:5px;}
.trip-stat{background:var(--elevated);border-radius:var(--rs);padding:7px 10px;}
.trip-stat-label{font-size:9px;color:var(--muted2);letter-spacing:.04em;text-transform:uppercase;}
.trip-stat-value{font-size:13px;font-weight:700;color:var(--text);margin-top:2px;font-variant-numeric:tabular-nums;}
.empty-state{text-align:center;padding:60px 20px;color:var(--muted2);}
.empty-icon{font-size:40px;margin-bottom:14px;opacity:.6;}
.empty-title{font-size:16px;font-weight:700;margin-bottom:6px;color:var(--text);}
.empty-sub{font-size:12px;line-height:1.6;}

/* Fuel modal */
.fuel-modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:300;display:flex;align-items:flex-end;justify-content:center;}
.fuel-modal{background:var(--surface);border:0.5px solid var(--border);border-radius:16px 16px 0 0;padding:24px 18px 36px;width:100%;max-width:480px;}
.fuel-modal-title{font-size:18px;font-weight:700;color:var(--text);margin-bottom:4px;}
.fuel-modal-sub{font-size:12px;color:var(--muted);margin-bottom:20px;line-height:1.5;}

/* Trend card */
.trend-card{background:var(--surface);border:0.5px solid var(--border);border-radius:12px;padding:16px;margin-bottom:8px;}
.trend-card-header{display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:12px;}
.trend-card-title{font-size:13px;font-weight:600;color:var(--text);}
.trend-card-sub{font-size:10px;color:var(--muted2);margin-top:2px;}
.trend-badge{font-size:11px;font-weight:600;padding:3px 9px;border-radius:20px;}
.trend-badge.up{background:var(--green-dim);color:var(--green);border:0.5px solid var(--green-border);}
.trend-badge.down{background:var(--red-dim);color:var(--red);border:0.5px solid var(--red-border);}
.trend-badge.flat{background:var(--elevated);color:var(--muted);border:0.5px solid var(--border);}
.trend-weeks{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-top:4px;}
.trend-week{background:var(--elevated);border:0.5px solid var(--border);border-radius:var(--rs);padding:10px 8px;text-align:center;}
.trend-week.current{border-color:var(--green);background:var(--green-dim);}
.trend-week-label{font-size:9px;color:var(--muted2);margin-bottom:4px;letter-spacing:.05em;}
.trend-week-value{font-size:15px;font-weight:700;color:var(--text);font-variant-numeric:tabular-nums;}
.trend-week-shifts{font-size:9px;color:var(--muted2);margin-top:2px;}

/* Benchmarks */
.benchmark-card{background:var(--surface);border:0.5px solid var(--border);border-radius:12px;padding:16px;margin-bottom:8px;}
.benchmark-header{display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:14px;}
.benchmark-region{font-size:13px;font-weight:700;color:var(--text);margin-bottom:2px;}
.benchmark-week{font-size:10px;color:var(--muted2);}
.benchmark-live-dot{width:6px;height:6px;border-radius:50%;background:var(--green);box-shadow:0 0 6px var(--green);animation:pulse 2s infinite;flex-shrink:0;margin-top:5px;}
.benchmark-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:7px;margin-bottom:10px;}
.benchmark-stat{background:var(--elevated);border:0.5px solid var(--border);border-radius:var(--rs);padding:10px 8px;text-align:center;}
.benchmark-stat-label{font-size:9px;color:var(--muted2);letter-spacing:.06em;text-transform:uppercase;margin-bottom:4px;font-weight:500;}
.benchmark-stat-value{font-size:15px;font-weight:700;color:var(--text);font-variant-numeric:tabular-nums;}
.benchmark-footer{font-size:10px;color:var(--muted2);text-align:center;line-height:1.5;}
.benchmark-prompt{background:var(--surface);border:0.5px solid var(--border);border-radius:12px;padding:14px 16px;margin-bottom:8px;display:flex;gap:10px;align-items:center;cursor:pointer;transition:border-color var(--tr);}
.benchmark-prompt:hover{border-color:var(--green);}

/* Hall of Fame */
.hof-section{margin-top:16px;border-top:0.5px solid var(--border);padding-top:14px;}
.hof-title{font-size:13px;font-weight:700;color:var(--text);margin-bottom:10px;display:flex;align-items:center;gap:6px;}
.hof-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;}
.hof-card{background:var(--elevated);border:0.5px solid var(--border);border-radius:var(--rs);padding:12px 14px;position:relative;overflow:hidden;}
.hof-card::before{content:'';position:absolute;top:0;left:0;right:0;height:2px;}
.hof-card.gold::before{background:var(--amber);}
.hof-card.purple::before{background:var(--purple);}
.hof-card.green::before{background:var(--green);}
.hof-card.teal::before{background:var(--blue);}
.hof-card-icon{font-size:18px;margin-bottom:6px;opacity:.9;}
.hof-card-label{font-size:9px;color:var(--muted2);letter-spacing:.1em;text-transform:uppercase;margin-bottom:4px;font-weight:500;}
.hof-card-value{font-size:20px;font-weight:700;color:var(--text);line-height:1;font-variant-numeric:tabular-nums;}
.hof-card-date{font-size:10px;color:var(--muted2);margin-top:4px;}
.hof-empty{text-align:center;color:var(--muted2);font-size:11px;padding:16px 0;}

/* Stats tile */
.stats-tile{margin:12px 14px 0;background:var(--surface);border:0.5px solid var(--border);border-radius:12px;overflow:hidden;}
.stats-tile-header{padding:14px 16px;border-bottom:0.5px solid var(--border);background:var(--surface);}
.stats-tile-title{font-size:15px;font-weight:700;color:var(--text);margin-bottom:10px;}
.period-tabs{display:flex;gap:5px;flex-wrap:wrap;}
.period-tab{padding:5px 12px;border-radius:20px;background:var(--elevated);border:0.5px solid var(--border);color:var(--muted);font-size:11px;font-weight:500;cursor:pointer;transition:all var(--tr);}
.period-tab.active{background:var(--green-dim);border-color:var(--green-border);color:var(--green);font-weight:600;}
.stats-tile-body{padding:16px;background:var(--surface);}
.stats-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;}
.stat-item{background:var(--elevated);border:0.5px solid var(--border);border-radius:var(--rs);padding:12px 13px;}
.stat-item.wide{grid-column:1/-1;}
.stat-label{font-size:9px;color:var(--muted2);letter-spacing:.08em;text-transform:uppercase;margin-bottom:4px;font-weight:500;}
.stat-value{font-size:20px;font-weight:700;color:var(--text);font-variant-numeric:tabular-nums;}
.stat-score-bar-bg{height:4px;background:var(--border);border-radius:2px;margin-top:6px;overflow:hidden;}
.stat-score-bar{height:100%;border-radius:2px;transition:width .5s ease;}
.stats-section-divider{grid-column:1/-1;font-size:10px;color:var(--muted2);letter-spacing:.1em;text-transform:uppercase;padding:4px 0 2px;border-top:0.5px solid var(--border);margin-top:4px;font-weight:500;}
.ded-stat{grid-column:1/-1;background:var(--green-dim);border:0.5px solid var(--green-border);border-radius:var(--rs);padding:12px 14px;}
.ded-stat-label{font-size:9px;color:var(--green);letter-spacing:.1em;text-transform:uppercase;margin-bottom:4px;font-weight:600;}
.ded-stat-value{font-size:24px;font-weight:700;color:var(--green);font-variant-numeric:tabular-nums;}
.ded-stat-sub{font-size:10px;color:var(--muted);margin-top:2px;}
.stats-empty{text-align:center;color:var(--muted2);font-size:12px;padding:24px 0;}

/* Chart */
.chart-section{margin:12px 14px 0;}
.chart-title{font-size:12px;font-weight:600;color:var(--muted);margin-bottom:10px;text-transform:uppercase;letter-spacing:.08em;}
.chart-wrap{background:var(--surface);border-radius:14px;padding:16px;box-shadow:var(--shadow-card);}

/* Detail screen */
.detail-header{padding:16px 16px 0;background:var(--bg);}
.detail-date{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.08em;font-weight:600;}
.detail-app-name{font-size:28px;font-weight:800;margin-top:3px;color:var(--text);letter-spacing:-.025em;}
.detail-section{margin:14px 14px 0;}
.detail-section-title{font-size:11px;color:var(--muted2);letter-spacing:.08em;text-transform:uppercase;margin-bottom:10px;font-weight:700;}
.detail-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;}
.detail-item{background:var(--surface);border-radius:14px;padding:13px;box-shadow:var(--shadow-card);}
.detail-item.wide{grid-column:1/-1;}
.detail-item-label{font-size:10px;color:var(--muted2);margin-bottom:4px;text-transform:uppercase;letter-spacing:.05em;font-weight:500;}
.detail-item-value{font-size:17px;font-weight:800;color:var(--text);font-variant-numeric:tabular-nums;font-family:'Geist Mono',monospace;letter-spacing:-.01em;}
.detail-action-bar{padding:14px 14px 24px;background:var(--bg);border-top:0.5px solid var(--border);}
.detail-action-row{display:flex;gap:8px;}

/* Order Session */
.order-session-header{background:var(--surface);border-bottom:0.5px solid var(--border);padding:16px 16px 12px;position:sticky;top:0;z-index:50;box-shadow:0 1px 0 rgba(0,0,0,.02);}
.order-running-totals{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-top:12px;}
.order-total-card{background:var(--bg);border-radius:12px;padding:10px 8px;text-align:center;}
.order-total-label{font-size:9px;color:var(--muted2);letter-spacing:.06em;text-transform:uppercase;margin-bottom:3px;font-weight:500;}
.order-total-value{font-size:18px;font-weight:800;color:var(--text);font-variant-numeric:tabular-nums;font-family:'Geist Mono',monospace;letter-spacing:-.01em;}
.order-card{background:var(--surface);border-radius:14px;padding:14px 16px;margin-bottom:8px;position:relative;box-shadow:var(--shadow-card);}
.order-card-num{font-size:10px;font-weight:700;color:var(--blue);letter-spacing:.12em;margin-bottom:8px;text-transform:uppercase;}
.order-card-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;}
.order-card-stat{background:var(--elevated);border-radius:10px;padding:8px 10px;}
.order-card-stat-label{font-size:9px;color:var(--muted2);text-transform:uppercase;letter-spacing:.05em;font-weight:500;}
.order-card-stat-value{font-size:14px;font-weight:700;color:var(--text);margin-top:2px;font-variant-numeric:tabular-nums;font-family:'Geist Mono',monospace;}
.order-delete-btn{position:absolute;top:12px;right:12px;width:28px;height:28px;border-radius:10px;background:var(--red-dim);border:none;color:var(--red);cursor:pointer;font-size:12px;display:flex;align-items:center;justify-content:center;transition:all var(--tr);}
.order-delete-btn:active{transform:scale(.92);}
.add-order-btn{width:100%;padding:14px;background:var(--surface);border:1.5px dashed var(--border2);border-radius:14px;color:var(--green);font-size:13px;font-weight:700;cursor:pointer;transition:all var(--tr);margin-bottom:8px;}
.add-order-btn:active{background:var(--green-dim);border-color:var(--green);}
.order-modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:200;display:flex;align-items:flex-end;justify-content:center;backdrop-filter:blur(4px);}
.order-modal{background:var(--surface);border-radius:18px 18px 0 0;padding:24px 18px 36px;width:100%;max-width:480px;max-height:90vh;overflow-y:auto;box-shadow:0 -8px 32px rgba(0,0,0,.15);}
.order-modal-title{font-size:19px;font-weight:800;color:var(--text);margin-bottom:16px;letter-spacing:-.02em;}
.finish-shift-bar{position:fixed;bottom:0;left:0;right:0;padding:12px 16px 20px;background:linear-gradient(transparent,var(--bg) 35%);z-index:100;}
.finish-shift-btn{width:100%;padding:16px;background:var(--green);color:#0B0F14;border:none;border-radius:12px;font-size:15px;font-weight:700;cursor:pointer;transition:all var(--tr);}
.finish-shift-btn:hover{background:#16a34a;}
.finish-shift-btn:disabled{background:var(--elevated);color:var(--muted2);cursor:not-allowed;}

/* Import / Export buttons */
.export-btn{padding:7px 13px;border-radius:var(--rs);background:var(--elevated);border:0.5px solid var(--border);color:var(--muted);font-size:11px;font-weight:600;cursor:pointer;transition:all var(--tr);white-space:nowrap;}
.export-btn:hover{border-color:var(--green);color:var(--green);}
.import-btn{padding:7px 13px;border-radius:var(--rs);background:var(--elevated);border:0.5px solid var(--border);color:var(--muted);font-size:11px;font-weight:600;cursor:pointer;transition:all var(--tr);display:flex;align-items:center;gap:6px;white-space:nowrap;}
.import-btn:hover{border-color:var(--blue);color:var(--blue);}
.import-btn.loading{border-color:var(--amber);color:var(--amber);pointer-events:none;}
.import-banner{margin:12px 14px 0;background:var(--green-dim);border-radius:14px;padding:13px 15px;display:flex;gap:10px;align-items:flex-start;}
.import-banner-icon{font-size:18px;flex-shrink:0;}
.import-banner-text{font-size:11px;color:var(--muted);line-height:1.6;}
.import-banner-title{font-size:13px;font-weight:700;color:var(--green);margin-bottom:3px;letter-spacing:-.01em;}

/* KM Toggle */
.km-toggle{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:12px;}
.km-toggle-btn{padding:10px 8px;border-radius:var(--rs);background:var(--elevated);border:1.5px solid var(--border);color:var(--muted);font-size:11px;font-weight:600;cursor:pointer;transition:all var(--tr);text-align:center;}
.km-toggle-btn.active{border-color:var(--blue);color:var(--blue);background:var(--blue-dim);}

/* Fuel card */
.fuel-card{background:var(--amber-dim);border:0.5px solid var(--amber-border);border-radius:var(--rs);padding:14px 16px;margin-top:10px;}
.fuel-card-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;}
.fuel-card-title{font-size:10px;color:var(--amber);letter-spacing:.08em;text-transform:uppercase;font-weight:700;}
.fuel-card-icon{font-size:18px;opacity:.8;}
.fuel-card-row{display:flex;justify-content:space-between;align-items:center;padding:4px 0;}
.fuel-card-label{font-size:11px;color:var(--muted);}
.fuel-card-value{font-size:15px;font-weight:700;color:var(--text);font-variant-numeric:tabular-nums;}
.fuel-card-net{display:flex;justify-content:space-between;align-items:center;border-top:0.5px solid var(--amber-border);margin-top:8px;padding-top:10px;}
.fuel-card-net-label{font-size:13px;font-weight:700;color:var(--amber);}
.fuel-card-net-value{font-size:24px;font-weight:700;color:var(--green);font-variant-numeric:tabular-nums;}
.fuel-prompt{background:var(--elevated);border:0.5px solid var(--border);border-radius:var(--rs);padding:12px 14px;margin-top:10px;display:flex;align-items:center;gap:10px;cursor:pointer;transition:border-color var(--tr);}
.fuel-prompt:hover{border-color:var(--amber);}
.fuel-prompt-text{font-size:11px;color:var(--muted);line-height:1.5;}
.fuel-prompt-text strong{color:var(--amber);display:block;font-size:12px;font-weight:700;margin-bottom:2px;}

/* Active Shift Screen */
.active-shift-screen{display:flex;flex-direction:column;height:100vh;background:var(--bg);overflow:hidden;}
.shift-top-panel{flex-shrink:0;padding:14px 16px 12px;background:var(--surface);border-bottom:0.5px solid var(--border);z-index:10;}
.shift-stats-row{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px;}
.shift-stat-card{background:var(--elevated);border:0.5px solid var(--border);border-radius:12px;padding:13px 15px;}
.shift-stat-label{font-size:10px;color:var(--muted2);letter-spacing:.1em;text-transform:uppercase;margin-bottom:4px;font-weight:500;}
.shift-stat-value{font-size:32px;font-weight:700;color:var(--text);line-height:1;font-variant-numeric:tabular-nums;}
.shift-stat-unit{font-size:12px;color:var(--muted2);margin-top:2px;}
.shift-stat-card.earning .shift-stat-value{color:var(--green);}
.shift-status-bar{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;}
.shift-status-dot{width:7px;height:7px;border-radius:50%;margin-right:6px;flex-shrink:0;}
.shift-status-dot.active{background:var(--green);box-shadow:0 0 6px var(--green);animation:pulse 2s infinite;}
.shift-status-dot.paused{background:var(--amber);}
.shift-status-text{font-size:14px;font-weight:600;color:var(--text);}
.shift-ctrl-btns{display:grid;grid-template-columns:1fr 1fr;gap:8px;}
.shift-ctrl-btn{padding:13px;border-radius:10px;font-size:14px;font-weight:700;cursor:pointer;border:none;transition:all var(--tr);text-align:center;}
.shift-ctrl-btn.pause{background:var(--amber-dim);color:var(--amber);border:0.5px solid var(--amber-border);}
.shift-ctrl-btn.resume{background:var(--green-dim);color:var(--green);border:0.5px solid var(--green-border);}
.shift-ctrl-btn.end{background:var(--green);color:#0B0F14;}
.shift-ctrl-btn.end:hover{background:#16a34a;}

/* Confirm dialog */
.overlay{position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:300;display:flex;align-items:flex-end;justify-content:center;opacity:0;pointer-events:none;transition:opacity .2s ease;}
.overlay.show{opacity:1;pointer-events:all;}
.confirm-box{background:var(--surface);border:0.5px solid var(--border);border-radius:16px 16px 0 0;padding:24px 20px 34px;width:100%;max-width:480px;transform:translateY(20px);transition:transform .25s ease;}
.overlay.show .confirm-box{transform:translateY(0);}
.confirm-title{font-size:18px;font-weight:700;text-align:center;margin-bottom:6px;color:var(--text);}
.confirm-sub{font-size:13px;color:var(--muted);text-align:center;margin-bottom:22px;line-height:1.6;}
.confirm-btns{display:flex;flex-direction:column;gap:8px;}

/* Toast */
.toast{position:fixed;bottom:90px;left:50%;transform:translateX(-50%) translateY(16px);background:var(--surface);border:0.5px solid var(--green-border);color:var(--text);padding:11px 22px;border-radius:30px;font-size:13px;font-weight:600;z-index:400;opacity:0;pointer-events:none;transition:all .28s ease;white-space:nowrap;box-shadow:0 4px 24px rgba(0,0,0,.4);}
.toast.show{opacity:1;transform:translateX(-50%) translateY(0);}

/* Timer card */
.timer-card{background:var(--surface);border:0.5px solid var(--border);border-radius:14px;padding:22px 18px;margin-bottom:12px;text-align:center;}
.timer-status{font-size:10px;letter-spacing:.16em;text-transform:uppercase;margin-bottom:8px;font-weight:700;}
.timer-status.active{color:var(--green);}
.timer-status.paused{color:var(--amber);}
.timer-display{font-size:48px;font-weight:700;color:var(--text);font-family:'Geist Mono',monospace;letter-spacing:.04em;margin-bottom:6px;line-height:1;font-variant-numeric:tabular-nums;}
.timer-started{font-size:11px;color:var(--muted2);margin-bottom:18px;}
.timer-btns{display:flex;gap:8px;}
.timer-btn{flex:1;padding:12px 8px;border-radius:10px;font-size:13px;font-weight:700;cursor:pointer;border:none;transition:all var(--tr);}
.timer-btn-pause{background:var(--amber-dim);color:var(--amber);border:0.5px solid var(--amber-border);}
.timer-btn-end{background:var(--green);color:#0B0F14;}
.timer-btn-start{background:var(--green-dim);color:var(--green);border:0.5px solid var(--green-border);}

/* Settings */
.settings-section{margin:12px 14px 0;}
.settings-section-title{font-size:10px;color:var(--muted2);letter-spacing:.14em;text-transform:uppercase;margin-bottom:10px;font-weight:700;}
.settings-item{display:flex;justify-content:space-between;align-items:center;background:transparent;border:none;padding:13px 15px;transition:opacity var(--tr);}
.settings-item:active{opacity:.65;}
.settings-item-left{display:flex;flex-direction:column;gap:3px;}
.settings-item-label{font-size:13px;font-weight:500;color:var(--text);}
.settings-item-sub{font-size:11px;color:var(--muted);}
.settings-input{background:transparent !important;border:none !important;color:var(--text) !important;border-radius:var(--rs);padding:6px 8px;font-family:'Geist Mono',monospace;font-size:14px;font-weight:600;outline:none;width:90px;text-align:right;transition:background var(--tr);font-variant-numeric:tabular-nums;}
.settings-input:focus{background:var(--elevated) !important;}
.version-tag{text-align:center;font-size:10px;color:var(--muted2);padding:20px;letter-spacing:.1em;text-transform:uppercase;}
.info-box{font-size:11px;color:var(--muted);line-height:1.6;padding:10px 12px;background:var(--elevated);border-radius:var(--rs);border:0.5px solid var(--border);}

/* Weekly goal card */
.goal-card{background:var(--surface);border:0.5px solid var(--border);border-radius:12px;padding:16px;margin-bottom:8px;}
.goal-card-top{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px;}
.goal-card-label{font-size:10px;color:var(--muted2);letter-spacing:.1em;text-transform:uppercase;margin-bottom:4px;font-weight:500;}
.goal-card-earned{font-size:28px;font-weight:700;color:var(--text);line-height:1;font-variant-numeric:tabular-nums;}
.goal-card-target{font-size:11px;color:var(--muted2);margin-top:3px;}
.goal-bar-bg{height:5px;background:var(--elevated);border-radius:3px;overflow:hidden;margin-bottom:8px;}
.goal-bar{height:100%;border-radius:3px;background:var(--grad);transition:width .6s ease;}
.goal-bar-info{display:flex;justify-content:space-between;font-size:11px;color:var(--muted2);}
.goal-pct{font-weight:700;color:var(--green);}
.goal-celebrate{text-align:center;padding:12px 0 2px;}
.goal-celebrate-emoji{font-size:28px;margin-bottom:6px;}
.goal-celebrate-title{font-size:15px;font-weight:700;color:var(--green);margin-bottom:3px;}
.goal-celebrate-sub{font-size:11px;color:var(--muted);}

/* Paywall */
.paywall-billing-toggle{display:flex;background:var(--elevated);border:0.5px solid var(--border);border-radius:10px;padding:4px;margin-bottom:20px;gap:4px;}
.paywall-billing-btn{flex:1;padding:10px;border-radius:var(--rs);border:none;cursor:pointer;font-family:'Inter',sans-serif;font-size:13px;font-weight:600;transition:all .2s ease;position:relative;}
.paywall-billing-btn.active{background:var(--green);color:#0B0F14;}
.paywall-billing-btn.inactive{background:transparent;color:var(--muted);}
.paywall-save-badge{position:absolute;top:-8px;right:6px;font-size:8px;background:var(--amber);color:#0B0F14;padding:2px 5px;border-radius:6px;font-weight:800;letter-spacing:.04em;}
.paywall-price-card{text-align:center;padding:22px;background:var(--green-dim);border:1.5px solid var(--green-border);border-radius:14px;margin-bottom:20px;}
.paywall-amount{font-size:48px;font-weight:700;color:var(--text);line-height:1;font-variant-numeric:tabular-nums;}
.paywall-trial-badge{font-size:11px;font-weight:700;color:var(--blue);letter-spacing:.08em;text-transform:uppercase;margin-top:10px;}

/* Bottom Nav */
.bottom-nav{
  position:fixed;bottom:0;left:0;right:0;
  height:76px;
  background:var(--nav-bg);
  -webkit-backdrop-filter:saturate(180%) blur(20px);
  backdrop-filter:saturate(180%) blur(20px);
  border-top:0.5px solid var(--border);
  display:flex;align-items:stretch;z-index:200;
  padding-bottom:8px;
}
.bottom-nav-item{
  display:flex;flex-direction:column;align-items:center;justify-content:center;
  gap:4px;cursor:pointer;flex:1;
  -webkit-tap-highlight-color:transparent;
  transition:opacity var(--tr);
}
.bottom-nav-item:active{opacity:.6;}
.bottom-nav-label{
  font-size:10px;font-weight:600;letter-spacing:.02em;
}
.bottom-nav-item.active .bottom-nav-label{color:var(--green);font-weight:700;}
.bottom-nav-item.inactive .bottom-nav-label{color:var(--muted2);}
.bottom-nav-center{
  display:flex;flex-direction:column;align-items:center;justify-content:center;
  gap:4px;cursor:pointer;flex:1;
  -webkit-tap-highlight-color:transparent;
}
.bottom-nav-center-icon{
  width:46px;height:46px;
  background:linear-gradient(180deg,#00A050 0%,#008F44 100%);
  border-radius:14px;
  display:flex;align-items:center;justify-content:center;
  margin-top:-20px;
  box-shadow:0 8px 22px -4px rgba(0,143,68,.45), inset 0 1px 0 rgba(255,255,255,.2);
  transition:transform var(--tr);
}
.bottom-nav-center:active .bottom-nav-center-icon{transform:scale(.96);}
.bottom-nav-center-label{
  font-size:10px;font-weight:600;letter-spacing:.02em;color:var(--muted2);
}
`;

// ─── COMPONENTS ───────────────────────────────

function Toast({ msg }) {
  return <div className={`toast${msg ? " show" : ""}`}>{msg}</div>;
}

// ─── BOTTOM NAV ──────────────────────────────────────────────────────────────
function BottomNav({ active, onHome, onLogShift, onLog, onInsights, onSettings }) {
  const IconHome = ({ color }) => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12L12 4l9 8" />
      <path d="M5 10v9a1 1 0 001 1h4v-4h4v4h4a1 1 0 001-1v-9" />
    </svg>
  );
  const IconLogShift = () => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#0B0F14" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M8.5 12.5l2.5 2.5 4.5-5" />
    </svg>
  );
  // List icon for Shift Log
  const IconShiftLog = ({ color }) => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round">
      <rect x="4" y="4" width="16" height="16" rx="2"/>
      <line x1="8" y1="9" x2="16" y2="9"/>
      <line x1="8" y1="13" x2="16" y2="13"/>
      <line x1="8" y1="17" x2="13" y2="17"/>
    </svg>
  );
  // Bar chart icon for Insights
  const IconInsights = ({ color }) => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="20" x2="18" y2="10"/>
      <line x1="12" y1="20" x2="12" y2="4"/>
      <line x1="6"  y1="20" x2="6"  y2="14"/>
      <line x1="3"  y1="20" x2="21" y2="20"/>
    </svg>
  );
  const IconSettings = ({ color }) => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round">
      <line x1="4" y1="7"  x2="20" y2="7" />
      <line x1="4" y1="12" x2="20" y2="12" />
      <line x1="4" y1="17" x2="20" y2="17" />
    </svg>
  );

  const activeColor   = "#22C55E";
  const inactiveColor = "#6B7888";

  return (
    <nav className="bottom-nav">
      <div className={`bottom-nav-item ${active === "home" ? "active" : "inactive"}`} onClick={onHome}>
        <IconHome color={active === "home" ? activeColor : inactiveColor} />
        <div className="bottom-nav-label">Home</div>
      </div>
      <div className={`bottom-nav-item ${active === "log" ? "active" : "inactive"}`} onClick={onLog}>
        <IconShiftLog color={active === "log" ? activeColor : inactiveColor} />
        <div className="bottom-nav-label">Shift Log</div>
      </div>
      {/* Centre Log Shift button */}
      <div className="bottom-nav-center" onClick={onLogShift}>
        <div className="bottom-nav-center-icon"><IconLogShift /></div>
        <div className="bottom-nav-center-label">Log Shift</div>
      </div>
      <div className={`bottom-nav-item ${active === "insights" ? "active" : "inactive"}`} onClick={onInsights}>
        <IconInsights color={active === "insights" ? activeColor : inactiveColor} />
        <div className="bottom-nav-label">Insights</div>
      </div>
      <div className={`bottom-nav-item ${active === "settings" ? "active" : "inactive"}`} onClick={onSettings}>
        <IconSettings color={active === "settings" ? activeColor : inactiveColor} />
        <div className="bottom-nav-label">Settings</div>
      </div>
    </nav>
  );
}

// ─── GT LOGO — embedded from GigTrack_Logo.png ───────────────────────────────
const GT_LOGO_SRC = "data:image/png;base64,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pITjuABssQ6wcV0s5dSOlHLhRI3vLba4F97uODo7cuSg9u4JhioqBnGGaRUT1VKNFAufRxHBsuV0R7pGrm5BBERYLTQ1NRljDDU3NztKqYW//vWvLzvk0EO3u/yXv/jZQw899BVb69T2668qKitca61dU0OLiolXqcV45efpfJb29kq1pj5Lfp1KHMumUAQDgXFdF0opY42lhFPxJgC0tbXJxS2IgAirZ01LJpOutZb8tN+5l152WfMB++8/6fJfXn7hQw899NHSJUud/v37q4qKCgPAeFrCJavEe7LAFpttEuXWKXwf4a6leFZC0YU94v2Wem+lmijGnS5JRLDWsiIy1RWVVmtd+cgjjyy869//fpSZye/YLAjdRtq5C90SEgDEM2YodcwxX1xyySWXAZh+6qmnnrb33nt/Y8qUKdttttlmAICOjg7jui6R788J6irCYiLFFs1SKcBh8YO4bVfCXtN7zp5N8OOC9xenCLDYey/mnspPDPB/uLKy0lZVVWkw9Esvvoi2WbMe/uct/zzv1VdffbulpUUhr+OAIIiACKtVSKipyQCg5uZmfckllyy5+eabr7z55pt/t++++x5++OGHHzNp60mHTt5mckX//v2RyWSsMYatMYqUolKLeljFencslGIL9io/QMbmhISKiGNcQSsmhoxcyrFJJBJcUVHhpNNp/cQTTyx+4okn7rntttv+8NJLLz0deB7E+hBEQIQ+ZZE0NzfrSy+91H344Ydve/jhh2+rra2d8P3vfveYSZMmnzxlypRx48aNAxQhlUqZTCbjGySemBQLMherc4hbf1K4iw+d1Z6/ppOXymutxZIlS3p2gLgzoTeOpdTlWOTJT2hrewKYLTs6YSorKrRSSn/xxRd47rnnPnruuef+dMkll/wJwCf+46mlpUVcV4IIiNB3haSxsVHNmDEDRPTWz3/xi58B+E3jEUc07L7nnt+YNGnyflttvfXAoUOHgplhrHGz2Sy5rqu01hQmCMXqPspxbRWLk+QshV4sJCz0EJVTs5K7fxCPyXusZYY1hrXWtipRAe042hjjvPrqq5gzZ86DDz300F1//etf/wVgsf8auqWlhYnIorc6RQqCCIiwKoQkaBvf3NysttpqKzr22GPbW++8877WO++8D8AGp59y+sHbbDvpuMmTJu+29TaTE0OGDIG1Ful02riuC2tt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";

function GTLogo({ size = 32 }) {
  return (
    <img
      src={GT_LOGO_SRC}
      width={size}
      height={size}
      alt="GigTrack"
      style={{
        width: size,
        height: size,
        objectFit: "contain",
        display: "block",
        flexShrink: 0,
      }}
    />
  );
}

// Wordmark: "Gig" white + "Track" green
function GTWordmark({ fontSize = 18 }) {
  return (
    <span className="gt-wordmark" style={{fontSize}}>
      <span className="gt-wordmark-gig">Gig</span><span className="gt-wordmark-track">Track</span>
    </span>
  );
}

// Combined logo + wordmark row
function GTBrand({ size = 30, fontSize = 18 }) {
  return (
    <div className="gt-logo-wrap">
      <GTLogo size={size} />
      <GTWordmark fontSize={fontSize} />
    </div>
  );
}

function ConfirmDialog({ show, title, sub, onConfirm, onCancel }) {
  return (
    <div className={`overlay${show ? " show" : ""}`} onClick={(e) => e.target.className.includes("overlay") && onCancel()}>
      <div className="confirm-box">
        <div className="confirm-title">{title}</div>
        <div className="confirm-sub">{sub}</div>
        <div className="confirm-btns">
          <button className="btn btn-danger" style={{width:"100%",padding:"16px"}} onClick={onConfirm}>{title.includes("Delete") ? "🗑 Yes, Delete" : "Confirm"}</button>
          <button className="btn btn-outline" style={{width:"100%",padding:"16px"}} onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

function RatioBar({ ratio, label }) {
  if (ratio === null || ratio === undefined) return null;
  const pct = (Math.min(ratio, 1.5) / 1.5) * 100;
  const color = ratio >= 1 ? "var(--green)" : ratio >= 0.8 ? "var(--yellow)" : "var(--red)";
  return (
    <div className="ratio-card">
      <div className="ratio-card-label">{label}</div>
      <div className="ratio-bar-bg"><div className="ratio-bar" style={{ width: pct + "%", background: color }} /></div>
      <div className="ratio-value" style={{ color }}>{fmtPct(ratio * 100)}</div>
    </div>
  );
}

// ─── SETUP FLOW ───
// ─── PREMIUM FEATURES DEFINITION ─────────────────
const PREMIUM_FEATURES = [
  { icon:"📍", title:"Local Benchmarks",          desc:"See how you stack up against real GigTrack drivers in your region — weekly averages for hourly rate, $ per delivery, and shift score." },
  { icon:"🧾", title:"ATO PDF Export",             desc:"One-tap export of your full shift log as a print-ready ATO tax report. Includes deductions, totals, and every shift detail." },
  { icon:"🎯", title:"Weekly Earnings Goal",       desc:"Set a weekly earnings target and track your progress live on the home screen with a visual goal bar." },
  { icon:"⚡", title:"Custom Scoring Targets",     desc:"Dial in your own hourly rate, $/delivery, and active time targets so your shift score reflects your personal benchmarks." },
];

// ─── PREMIUM PAYWALL SCREEN ────────────────────────
// Used both during onboarding and from Settings → Go Premium
function PremiumPaywallScreen({ onBack, onSubscribe, fromOnboarding = false }) {
  const [billing, setBilling] = useState("monthly"); // "monthly" | "annual"
  const monthlyPrice = 4.99;
  const annualTotal  = 44.99;
  const annualPrice  = annualTotal / 12; // ≈ $3.75/mo
  const saving = Math.round((1 - annualPrice / monthlyPrice) * 100);

  return (
    <div className="view active" style={{background:"var(--bg)"}}>
      {/* Header */}
      <div style={{display:"flex",alignItems:"center",gap:"12px",padding:"18px 18px 0",position:"sticky",top:0,zIndex:50,background:"var(--bg)"}}>
        <button className="topbar-back" onClick={onBack}>←</button>
        <GTBrand size={28} fontSize={16} />
      </div>

      <div style={{flex:1,overflowY:"auto",padding:"24px 18px 140px"}}>

        {/* Hero */}
        <div style={{textAlign:"center",marginBottom:"24px",maxWidth:"320px",margin:"0 auto 24px"}}>
          <div style={{fontFamily:"'Inter',sans-serif",fontSize:"10px",fontWeight:"700",color:"var(--green)",letterSpacing:".14em",textTransform:"uppercase",marginBottom:"10px"}}>
            GigTrack Pro
          </div>
          <div style={{fontFamily:"'Inter',sans-serif",fontSize:"26px",fontWeight:"800",color:"var(--text)",letterSpacing:"-.025em",lineHeight:"1.15",marginBottom:"10px"}}>
            Maximise every shift.
          </div>
          <div style={{fontFamily:"'Inter',sans-serif",fontSize:"12px",color:"var(--muted)",lineHeight:"1.6"}}>
            Tools to earn more, deduct smarter, and stay on top of tax time.
          </div>
        </div>

        {/* Billing toggle */}
        <div style={{display:"flex",background:"var(--surface)",border:"0.5px solid var(--border)",borderRadius:"12px",padding:"4px",marginBottom:"16px",gap:"4px"}}>
          {[["monthly","Monthly"],["annual","Annual"]].map(([k,l]) => (
            <button
              key={k}
              onClick={() => setBilling(k)}
              style={{flex:1,padding:"11px",borderRadius:"9px",border:"none",cursor:"pointer",fontFamily:"'Inter',sans-serif",fontSize:"13px",fontWeight:"700",transition:"all .2s ease",
                background: billing===k ? "var(--green)" : "transparent",
                color: billing===k ? "#0B0F14" : "var(--muted2)",
                position:"relative",
                letterSpacing:".01em",
              }}
            >
              {l}
              {k==="annual" && (
                <span style={{
                  position:"absolute",top:"-8px",right:"6px",
                  fontFamily:"'Inter',sans-serif",fontSize:"9px",
                  background: billing==="annual" ? "#0B0F14" : "var(--green)",
                  color: billing==="annual" ? "var(--green)" : "#0B0F14",
                  padding:"2px 7px",borderRadius:"6px",
                  fontWeight:"800",letterSpacing:".04em",
                }}>SAVE {saving}%</span>
              )}
            </button>
          ))}
        </div>

        {/* Price card */}
        <div style={{
          textAlign:"center",marginBottom:"24px",padding:"22px 20px",
          background:"linear-gradient(180deg, var(--green-dim), var(--surface))",
          border:"1px solid var(--green-border)",
          borderRadius:"16px",
          position:"relative",
        }}>
          <div style={{
            position:"absolute",top:"-9px",left:"50%",transform:"translateX(-50%)",
            fontFamily:"'Inter',sans-serif",fontSize:"9px",fontWeight:"800",
            letterSpacing:".08em",textTransform:"uppercase",
            background:"var(--green)",color:"#0B0F14",
            padding:"3px 10px",borderRadius:"6px",
          }}>7-day free trial</div>

          <div style={{fontFamily:"'Inter',sans-serif",fontSize:"42px",fontWeight:"800",color:"var(--text)",letterSpacing:"-.03em",lineHeight:"1",fontVariantNumeric:"tabular-nums",marginTop:"6px"}}>
            ${billing==="annual" ? annualPrice.toFixed(2) : monthlyPrice.toFixed(2)}
            <span style={{fontSize:"16px",color:"var(--muted)",fontWeight:"500"}}>/mo</span>
          </div>
          {billing==="annual" ? (
            <div style={{fontFamily:"'Inter',sans-serif",fontSize:"11px",color:"var(--muted)",marginTop:"6px"}}>
              Billed as ${annualTotal.toFixed(2)}/year · Save ${(monthlyPrice*12 - annualTotal).toFixed(2)} vs monthly
            </div>
          ) : (
            <div style={{fontFamily:"'Inter',sans-serif",fontSize:"11px",color:"var(--muted)",marginTop:"6px"}}>
              Cancel anytime · No lock-in
            </div>
          )}
        </div>

        {/* Feature list */}
        <div style={{marginBottom:"20px"}}>
          <div style={{fontFamily:"'Inter',sans-serif",fontSize:"11px",fontWeight:"700",letterSpacing:".14em",color:"var(--muted2)",textTransform:"uppercase",marginBottom:"12px"}}>Everything in Pro</div>
          <div style={{display:"flex",flexDirection:"column",gap:"8px"}}>
            {PREMIUM_FEATURES.map(f => (
              <div key={f.title} style={{
                display:"flex",gap:"12px",alignItems:"flex-start",
                padding:"14px",
                background:"var(--surface)",
                border:"0.5px solid var(--border)",
                borderRadius:"12px",
              }}>
                <div style={{
                  width:"28px",height:"28px",borderRadius:"8px",
                  background:"var(--green-dim)",color:"var(--green)",
                  display:"flex",alignItems:"center",justifyContent:"center",
                  fontWeight:"700",fontSize:"14px",flexShrink:0,
                }}>✓</div>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontFamily:"'Inter',sans-serif",fontSize:"13px",fontWeight:"700",color:"var(--text)",marginBottom:"3px",letterSpacing:"-.005em"}}>{f.title}</div>
                  <div style={{fontFamily:"'Inter',sans-serif",fontSize:"11px",color:"var(--muted)",lineHeight:"1.55"}}>{f.desc}</div>
                </div>
              </div>
            ))}
            {/* Free features included */}
            <div style={{
              padding:"14px",
              background:"var(--surface)",
              border:"0.5px solid var(--border)",
              borderRadius:"12px",
            }}>
              <div style={{fontFamily:"'Inter',sans-serif",fontSize:"11px",fontWeight:"700",color:"var(--muted)",marginBottom:"10px",letterSpacing:".01em"}}>Plus everything in Free:</div>
              {["Shift timer & manual logging","KM tracking & ATO deduction calc","Shift scoring","Fuel cost estimator","Lifetime stats & charts"].map(f => (
                <div key={f} style={{display:"flex",alignItems:"center",gap:"9px",padding:"3px 0",fontFamily:"'Inter',sans-serif",fontSize:"12px",color:"#D1D5DB"}}>
                  <span style={{color:"var(--green)",fontWeight:"700",fontSize:"12px"}}>✓</span> {f}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Social proof */}
        <div style={{
          padding:"16px",
          background:"var(--surface)",
          border:"0.5px solid var(--border)",
          borderRadius:"12px",marginBottom:"20px",textAlign:"center",
        }}>
          <div style={{fontFamily:"'Inter',sans-serif",fontSize:"12px",color:"var(--muted)",lineHeight:"1.65",fontStyle:"italic"}}>
            "The community benchmarks are gold. Finally I can see how I stack up against other drivers in my area."
          </div>
          <div style={{fontFamily:"'Inter',sans-serif",fontSize:"10px",color:"var(--muted2)",marginTop:"8px",letterSpacing:".02em"}}>— GigTrack driver, Brisbane South</div>
        </div>

        {/* Fine print */}
        <div style={{fontFamily:"'Inter',sans-serif",fontSize:"10px",color:"var(--muted2)",lineHeight:"1.7",textAlign:"center"}}>
          Subscription auto-renews. Cancel anytime in settings before trial ends.<br/>
          By subscribing you agree to our Terms &amp; Privacy Policy.
        </div>
      </div>

      {/* CTA */}
      <div style={{position:"fixed",bottom:0,left:0,right:0,padding:"12px 18px 28px",background:"linear-gradient(transparent, var(--bg) 30%)",zIndex:100}}>
        <button
          onClick={() => onSubscribe(billing)}
          style={{
            width:"100%",padding:"17px",
            background:"var(--green)",color:"#0B0F14",
            border:"none",borderRadius:"14px",
            fontFamily:"'Inter',sans-serif",fontSize:"15px",fontWeight:"700",
            cursor:"pointer",letterSpacing:".01em",
          }}
        >
          Start 7-day free trial →
        </button>
        {fromOnboarding && (
          <button
            onClick={onBack}
            style={{
              width:"100%",marginTop:"8px",padding:"13px",
              background:"transparent",border:"none",
              color:"var(--muted2)",
              fontFamily:"'Inter',sans-serif",fontSize:"13px",fontWeight:"500",
              cursor:"pointer",
            }}
          >
            Continue with Free plan
          </button>
        )}
      </div>
    </div>
  );
}

// ─── WELCOME SCREEN ─── Forced sign-in gateway. Both new and returning users come through here.
function WelcomeScreen({ onSignIn }) {
  return (
    <div className="setup-wrap">
      <GTBrand size={40} fontSize={24} />
      <div className="setup-sub" style={{marginBottom:"32px"}}>Your gig earnings, your ATO deductions — all in one place.</div>

      <div style={{width:"100%",maxWidth:"360px",display:"flex",flexDirection:"column",gap:"10px"}}>

        {/* Primary CTA — single sign-in button */}
        <button
          onClick={onSignIn}
          style={{
            width:"100%",padding:"16px",
            background:"var(--green)",color:"#0B0F14",
            border:"none",borderRadius:"13px",cursor:"pointer",
            fontFamily:"'Inter',sans-serif",fontSize:"15px",fontWeight:"700",
            letterSpacing:".01em",
          }}
        >Sign in with email →</button>

      </div>

      <div style={{
        marginTop:"16px",fontFamily:"'Inter',sans-serif",
        fontSize:"12px",color:"var(--muted)",
        textAlign:"center",maxWidth:"320px",lineHeight:"1.5",
      }}>
        New here? We'll create an account when you sign in.
      </div>

      <div style={{
        marginTop:"36px",fontFamily:"'Inter',sans-serif",
        fontSize:"11px",color:"var(--muted2)",
        textAlign:"center",maxWidth:"300px",lineHeight:"1.5",
      }}>
        Designed for Australian Uber Eats &amp; DoorDash drivers. Free to use forever — Pro features available.
      </div>
    </div>
  );
}

// ─── SETUP FLOW ───
function SetupScreen({ onComplete }) {
  // mode: "choose" | "paywall" | "name"
  // plan: "free" | "pro"
  const [mode, setMode]   = useState("choose");
  const [plan, setPlan]   = useState(null);
  const [name, setName]   = useState("");
  const [selectedRegion, setSelectedRegion] = useState("");
  const [err, setErr]     = useState("");
  const [nameStep, setNameStep] = useState(0); // 0=name, 1=region

  const regionsByState = REGIONS.reduce((acc, r) => {
    if (!acc[r.state]) acc[r.state] = {};
    const key = r.group || "_root";
    if (!acc[r.state][key]) acc[r.state][key] = [];
    acc[r.state][key].push(r);
    return acc;
  }, {});

  const RegionPicker = () => (
    <div className="input-group">
      <div className="input-row">
        <div className="input-label">Select your region (optional)</div>
        <select
          className="input-field"
          value={selectedRegion}
          onChange={e => setSelectedRegion(e.target.value)}
          style={{colorScheme:"dark"}}
        >
          <option value="">— Choose your region —</option>
          {Object.entries(regionsByState).map(([state, groups]) => (
            <React.Fragment key={state}>
              {Object.entries(groups).map(([groupName, regions]) => (
                <optgroup key={`${state}-${groupName}`} label={groupName === "_root" ? state : `${state} — ${groupName}`}>
                  {regions.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
                </optgroup>
              ))}
            </React.Fragment>
          ))}
        </select>
      </div>
      <div style={{fontSize:"11px",color:"var(--muted)",lineHeight:"1.6",padding:"10px 12px",background:"var(--elevated)",borderRadius:"8px",border:"1px solid #252530"}}>
        📍 We'll show you how GigTrack drivers in your area are performing. You can change this anytime in Settings.
      </div>
    </div>
  );

  const finish = (chosenPlan) => {
    onComplete({
      name: name.trim(),
      email: null,
      startOdo: 0,
      kmPref: "active",
      region: selectedRegion || null,
      isGuest: chosenPlan !== "pro",
      isPro: chosenPlan === "pro",
    });
  };

  // ── Plan chooser ──
  if (mode === "choose") {
    return (
      <div className="setup-wrap">
        <GTBrand size={32} fontSize={20} />
        <div className="setup-sub">Your gig earnings, your ATO deductions — all in one place.</div>

        {/* Hero */}
        <div style={{textAlign:"center",marginBottom:"22px",maxWidth:"360px"}}>
          <div style={{fontFamily:"'Inter',sans-serif",fontSize:"24px",fontWeight:"800",color:"var(--text)",letterSpacing:"-.025em",lineHeight:"1.15",marginBottom:"8px"}}>
            Pick your plan
          </div>
          <div style={{fontFamily:"'Inter',sans-serif",fontSize:"12px",color:"var(--muted)",lineHeight:"1.6"}}>
            You can upgrade or downgrade anytime in settings.
          </div>
        </div>

        {/* Plan cards */}
        <div style={{width:"100%",maxWidth:"400px",display:"flex",flexDirection:"column",gap:"12px"}}>

          {/* Free card */}
          <div
            onClick={() => { setPlan("free"); setMode("name"); }}
            style={{
              background:"var(--surface)",
              border:"0.5px solid var(--border)",
              borderRadius:"16px",padding:"18px",cursor:"pointer",
            }}
          >
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"6px"}}>
              <div style={{fontFamily:"'Inter',sans-serif",fontSize:"17px",fontWeight:"800",color:"var(--text)",letterSpacing:"-.01em"}}>Free</div>
              <div style={{fontFamily:"'Inter',sans-serif",fontSize:"18px",fontWeight:"800",color:"var(--green)",letterSpacing:"-.02em",fontVariantNumeric:"tabular-nums"}}>
                $0<span style={{fontSize:"11px",color:"var(--muted2)",fontWeight:"500"}}>/mo</span>
              </div>
            </div>
            <div style={{fontFamily:"'Inter',sans-serif",fontSize:"11px",color:"var(--muted)",marginBottom:"12px"}}>
              Everything to track shifts and tax
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:"4px",marginBottom:"14px"}}>
              {[
                ["Shift logging", "timer + manual"],
                ["ATO km deductions", "automatic"],
                ["Shift scoring", "& lifetime stats"],
                ["Fuel cost estimator", null],
              ].map(([title, sub]) => (
                <div key={title} style={{display:"flex",alignItems:"center",gap:"9px",padding:"4px 0"}}>
                  <span style={{color:"var(--green)",fontWeight:"700",fontSize:"13px",flexShrink:0}}>✓</span>
                  <span style={{fontFamily:"'Inter',sans-serif",fontSize:"12px",color:"#D1D5DB",lineHeight:"1.5"}}>
                    <strong style={{color:"var(--text)",fontWeight:"600"}}>{title}</strong>{sub ? ` — ${sub}` : ""}
                  </span>
                </div>
              ))}
            </div>
            <div style={{
              width:"100%",padding:"13px",
              background:"transparent",
              border:"0.5px solid var(--border2)",
              borderRadius:"11px",
              fontFamily:"'Inter',sans-serif",fontSize:"14px",fontWeight:"700",
              color:"var(--muted)",textAlign:"center",
            }}>
              Continue with Free
            </div>
          </div>

          {/* Pro card */}
          <div
            onClick={() => setMode("paywall")}
            style={{
              background:"linear-gradient(180deg, var(--green-dim), var(--surface))",
              border:"1px solid var(--green-border)",
              borderRadius:"16px",padding:"18px",cursor:"pointer",position:"relative",
            }}
          >
            <div style={{
              position:"absolute",top:"-9px",right:"14px",
              fontFamily:"'Inter',sans-serif",fontSize:"9px",fontWeight:"800",
              letterSpacing:".08em",textTransform:"uppercase",
              background:"var(--green)",color:"#0B0F14",
              padding:"3px 9px",borderRadius:"6px",
            }}>7-day free trial</div>

            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"6px"}}>
              <div style={{fontFamily:"'Inter',sans-serif",fontSize:"17px",fontWeight:"800",color:"var(--text)",letterSpacing:"-.01em"}}>Pro</div>
              <div style={{fontFamily:"'Inter',sans-serif",fontSize:"18px",fontWeight:"800",color:"var(--text)",letterSpacing:"-.02em",fontVariantNumeric:"tabular-nums"}}>
                $4.99<span style={{fontSize:"11px",color:"var(--muted2)",fontWeight:"500"}}>/mo</span>
              </div>
            </div>
            <div style={{fontFamily:"'Inter',sans-serif",fontSize:"11px",color:"var(--muted)",marginBottom:"12px"}}>
              Everything in Free, plus:
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:"4px",marginBottom:"14px"}}>
              {PREMIUM_FEATURES.map(f => (
                <div key={f.title} style={{display:"flex",alignItems:"center",gap:"9px",padding:"4px 0"}}>
                  <span style={{color:"var(--green)",fontWeight:"700",fontSize:"13px",flexShrink:0}}>✓</span>
                  <span style={{fontFamily:"'Inter',sans-serif",fontSize:"12px",color:"#D1D5DB",lineHeight:"1.5"}}>
                    <strong style={{color:"var(--text)",fontWeight:"600"}}>{f.title}</strong>
                  </span>
                </div>
              ))}
            </div>
            <div style={{
              width:"100%",padding:"13px",
              background:"var(--green)",color:"#0B0F14",
              border:"none",borderRadius:"11px",
              fontFamily:"'Inter',sans-serif",fontSize:"14px",fontWeight:"700",
              textAlign:"center",letterSpacing:".01em",
            }}>
              Start free trial →
            </div>
          </div>

        </div>
      </div>
    );
  }

  // ── Paywall screen (from onboarding) ──
  if (mode === "paywall") {
    return (
      <PremiumPaywallScreen
        fromOnboarding
        onBack={() => setMode("choose")}
        onSubscribe={(billing) => {
          // In production: trigger payment flow, then on success:
          setPlan("pro");
          setMode("name");
        }}
      />
    );
  }

  // ── Name + region step (shared for both plans) ──
  const currentPlan = plan;

  const handleNameNext = () => {
    if (nameStep === 0) {
      if (!name.trim()) { setErr("Please enter at least a first name."); return; }
      setErr(""); setNameStep(1);
    } else {
      finish(currentPlan);
    }
  };

  const stepLabel = currentPlan === "pro" ? "Almost there" : "Quick setup";

  return (
    <div className="setup-wrap">
      <GTBrand size={32} fontSize={20} />
      {currentPlan === "pro" && (
        <div style={{fontSize:"11px",color:"var(--purple)",marginBottom:"20px",background:"var(--purple-dim)",border:"1px solid rgba(109,93,252,.25)",borderRadius:"8px",padding:"8px 14px",fontFamily:"'Inter',sans-serif",fontWeight:"700",letterSpacing:".04em"}}>
          ✓ Pro trial activated
        </div>
      )}
      <div className="setup-card">
        <div className="setup-step-label">{stepLabel} · Step {nameStep + 1} of 2</div>
        <div className="setup-step-title">{nameStep === 0 ? "What should we call you?" : "Your delivery region"}</div>
        <div className="setup-step-sub">{nameStep === 0 ? "Just a first name is fine — this shows on your home screen." : "We'll show you how GigTrack drivers in your area are performing."}</div>

        {nameStep === 0 && (
          <div className="input-group">
            <div className="input-row">
              <div className="input-label">Your name</div>
              <input className="input-field" placeholder="e.g. Jordan" value={name} onChange={e => { setName(e.target.value); setErr(""); }} />
            </div>
          </div>
        )}

        {nameStep === 1 && <RegionPicker />}

        {err && <div className="val-msg show" style={{marginTop:"12px"}}>{err}</div>}

        <div className="setup-btns-row">
          <button className="btn btn-outline" style={{flex:1}} onClick={() => { setErr(""); nameStep === 0 ? setMode("choose") : setNameStep(0); }}>Back</button>
          <button className="btn btn-primary" style={{flex:2}} onClick={handleNameNext}>
            {nameStep === 1 ? "Let's Go 🚀" : "Continue →"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── LIVE TIMER ───
function LiveTimer({ activeShift, onEndShift, onPauseShift, onResumeShift }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const tick = () => {
      if (!activeShift || activeShift.paused) return;
      const base = activeShift.elapsed || 0;
      const since = Date.now() - activeShift.resumedAt;
      setElapsed(base + since);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [activeShift]);

  if (!activeShift) return null;

  const totalSecs = Math.floor((activeShift.paused ? activeShift.elapsed : elapsed) / 1000);
  const h = Math.floor(totalSecs / 3600);
  const m = Math.floor((totalSecs % 3600) / 60);
  const s = totalSecs % 60;
  const pad = n => String(n).padStart(2, "0");
  const display = h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  const startTime = new Date(activeShift.startedAt).toLocaleTimeString("en-CA", { hour: "2-digit", minute: "2-digit" });
  const isPaused = activeShift.paused;

  return (
    <div className="timer-card">
      <div className={`timer-status ${isPaused ? "paused" : "active"}`}>
        {isPaused ? "⏸ Shift Paused" : "🟢 Shift In Progress"}
      </div>
      <div className="timer-display">{display}</div>
      <div className="timer-started">Started at {startTime}</div>
      <div className="timer-btns">
        <button
          className={`timer-btn ${isPaused ? "timer-btn-start" : "timer-btn-pause"}`}
          onClick={isPaused ? onResumeShift : onPauseShift}
        >
          {isPaused ? "▶ Resume" : "⏸ Pause"}
        </button>
        <button className="timer-btn timer-btn-end" onClick={onEndShift}>
          ⏹ End Shift
        </button>
      </div>
    </div>
  );
}

// ─── FUEL CARD ───
function FuelCard({ totalKm, totalEarned, fuelEfficiency, fuelPrice, onSetFuel }) {
  const hasFuelSettings = fuelEfficiency > 0 && fuelPrice > 0;

  if (!hasFuelSettings) {
    return (
      <div className="fuel-prompt" onClick={onSetFuel}>
        <div style={{fontSize:"24px",flexShrink:0}}>⛽</div>
        <div className="fuel-prompt-text">
          <strong>Add fuel cost estimator</strong>
          Tap to enter your L/100km and fuel price — stays right here on this form.
        </div>
        <div style={{color:"var(--muted2)",fontSize:"18px",flexShrink:0}}>›</div>
      </div>
    );
  }

  const fuelCost  = totalKm > 0 ? (totalKm / 100) * fuelEfficiency * fuelPrice : 0;
  const netEarned = totalEarned - fuelCost;

  return (
    <div className="fuel-card">
      <div className="fuel-card-header">
        <div className="fuel-card-title">⛽ Fuel Cost Estimator</div>
        <div className="fuel-card-icon" style={{cursor:"pointer"}} onClick={onSetFuel} title="Edit fuel settings">✏️</div>
      </div>
      <div className="fuel-card-row">
        <div className="fuel-card-label">Distance</div>
        <div className="fuel-card-value">{totalKm.toFixed(1)} km</div>
      </div>
      <div className="fuel-card-row">
        <div className="fuel-card-label">Fuel used (~{fuelEfficiency}L/100km)</div>
        <div className="fuel-card-value">{((totalKm / 100) * fuelEfficiency).toFixed(1)} L</div>
      </div>
      <div className="fuel-card-row">
        <div className="fuel-card-label">Fuel cost (${fuelPrice.toFixed(2)}/L)</div>
        <div className="fuel-card-value" style={{color:"var(--red)"}}>−${fuelCost.toFixed(2)}</div>
      </div>
      <div className="fuel-card-net">
        <div className="fuel-card-net-label">Net Earnings (after fuel)</div>
        <div className="fuel-card-net-value" style={{color: netEarned >= 0 ? "var(--green)" : "var(--red)"}}>
          ${netEarned.toFixed(2)}
        </div>
      </div>
    </div>
  );
}

// ─── ACTIVE SHIFT SCREEN — simple timer, no GPS ───────────────────────────
function ActiveShiftScreen({ activeShift, onPause, onResume, onEnd }) {
  const [elapsed, setElapsed] = useState(0);
  const [gpsKm, setGpsKm] = useState(0);
  const [gpsStatus, setGpsStatus] = useState("asking"); // asking | granted | denied | unsupported
  const lastPosRef = useRef(null);
  const watchIdRef = useRef(null);

  // Timer tick
  useEffect(() => {
    if (activeShift?.paused) return;
    const tick = () => {
      const base  = activeShift?.elapsed  || 0;
      const since = Date.now() - (activeShift?.resumedAt || Date.now());
      setElapsed(base + since);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [activeShift]);

  // GPS tracking — Haversine distance accumulator
  useEffect(() => {
    if (!activeShift) return;
    if (activeShift.paused) return; // don't track while paused
    if (!("geolocation" in navigator)) { setGpsStatus("unsupported"); return; }

    const haversine = (lat1, lon1, lat2, lon2) => {
      const R = 6371; // km
      const toRad = d => d * Math.PI / 180;
      const dLat = toRad(lat2 - lat1);
      const dLon = toRad(lon2 - lon1);
      const a = Math.sin(dLat/2) ** 2 +
                Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
                Math.sin(dLon/2) ** 2;
      return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    };

    const onPos = (pos) => {
      setGpsStatus("granted");
      const { latitude, longitude, accuracy } = pos.coords;
      const now = Date.now();
      const last = lastPosRef.current;

      // Skip first reading — just store baseline
      if (!last) {
        lastPosRef.current = { lat: latitude, lon: longitude, t: now };
        return;
      }
      // Skip if accuracy is terrible (>100m)
      if (accuracy > 100) return;

      const d = haversine(last.lat, last.lon, latitude, longitude);
      const dt = (now - last.t) / 1000; // seconds

      // Filter: ignore GPS jumps that imply > 150km/h (likely a glitch/teleport)
      // Also ignore tiny movements (< 10m) — these are usually GPS jitter while stationary
      const kmh = dt > 0 ? (d / dt) * 3600 : 0;
      if (d >= 0.01 && kmh < 150) {
        setGpsKm(prev => prev + d);
        lastPosRef.current = { lat: latitude, lon: longitude, t: now };
      } else if (d >= 0.01) {
        // Big jump — reset baseline but don't add to total
        lastPosRef.current = { lat: latitude, lon: longitude, t: now };
      }
    };

    const onErr = (err) => {
      if (err.code === err.PERMISSION_DENIED) setGpsStatus("denied");
      else setGpsStatus("denied"); // treat all errors as denied for UX simplicity
    };

    watchIdRef.current = navigator.geolocation.watchPosition(onPos, onErr, {
      enableHighAccuracy: true,
      maximumAge: 10000,
      timeout: 30000,
    });

    return () => {
      if (watchIdRef.current != null) navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
      lastPosRef.current = null; // reset baseline on pause/unmount so resume starts fresh
    };
  }, [activeShift?.paused, activeShift?.startedAt]);

  if (!activeShift) return null;

  const totalSecs = Math.floor(
    (activeShift.paused ? activeShift.elapsed : elapsed) / 1000
  );
  const h   = Math.floor(totalSecs / 3600);
  const m   = Math.floor((totalSecs % 3600) / 60);
  const s   = totalSecs % 60;
  const pad = n => String(n).padStart(2, "0");

  const isPaused   = activeShift.paused;
  const startTime  = new Date(activeShift.startedAt)
    .toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit" });

  // Wrap onEnd to pass the captured km
  const handleEnd = () => {
    const totalMin = Math.floor(totalSecs / 60);
    onEnd(totalMin, +gpsKm.toFixed(2));
  };

  return (
    <div className="view active" style={{
      background: "var(--bg)",
      display: "flex",
      flexDirection: "column",
      minHeight: "100vh",
    }}>

      {/* Topbar */}
      <div className="topbar">
        <div style={{width:"34px"}} />
        <div className="topbar-title">Active Shift</div>
        <div style={{width:"34px"}} />
      </div>

      {/* Main content — vertically centred */}
      <div style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "0 24px 40px",
        gap: "20px",
      }}>

        {/* Status pill */}
        <div style={{
          display: "flex", alignItems: "center", gap: "8px",
          background: isPaused ? "var(--amber-dim)" : "var(--green-dim)",
          borderRadius: "100px", padding: "6px 14px",
        }}>
          <div style={{
            width: "8px", height: "8px", borderRadius: "50%",
            background: isPaused ? "var(--amber)" : "var(--green)",
            animation: isPaused ? "none" : "pulse 2s infinite",
          }} />
          <span style={{
            fontSize: "10px", fontWeight: "700", letterSpacing: ".12em",
            textTransform: "uppercase",
            color: isPaused ? "var(--amber)" : "var(--green)",
          }}>
            {isPaused ? "Paused" : "Active"}
          </span>
        </div>

        {/* Timer digits */}
        <div style={{
          fontFamily: "'Geist Mono', monospace",
          fontVariantNumeric: "tabular-nums",
          fontSize: "clamp(52px, 18vw, 72px)",
          fontWeight: "700",
          color: "var(--text)",
          lineHeight: 1,
          letterSpacing: "-.02em",
          textAlign: "center",
          width: "100%",
        }}>
          {`${pad(h)}:${pad(m)}:${pad(s)}`}
        </div>

        {/* Started at */}
        <div style={{fontSize:"12px",color:"var(--muted2)",letterSpacing:".02em"}}>
          Started at {startTime}
        </div>

        {/* GPS status banner — denied/unsupported */}
        {(gpsStatus === "denied" || gpsStatus === "unsupported") && (
          <div style={{
            background: "var(--amber-dim)",
            borderRadius: "10px",
            padding: "9px 12px",
            fontSize: "11px",
            color: "var(--amber)",
            textAlign: "center",
            maxWidth: "320px",
            width: "100%",
            lineHeight: "1.5",
          }}>
            {gpsStatus === "denied"
              ? "Location off — KMs won't auto-track. You can enter them manually when you save."
              : "GPS not supported on this browser. Enter KMs manually."}
          </div>
        )}

        {/* Stat tiles */}
        <div style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr",
          gap: "8px",
          width: "100%",
          maxWidth: "320px",
        }}>
          {[
            ["Hours", h > 0 ? `${h}h ${pad(m)}m` : `${m}m`],
            ["Minutes", String(Math.floor(totalSecs / 60))],
            ["KMs", gpsStatus === "granted" || gpsKm > 0 ? gpsKm.toFixed(1) : "—"],
          ].map(([label, value]) => (
            <div key={label} style={{
              background: "var(--surface)",
              borderRadius: "14px", padding: "14px 10px",
              textAlign: "center",
              boxShadow: "var(--shadow-card)",
            }}>
              <div style={{
                fontSize:"17px",fontWeight:"800",color:"var(--text)",
                fontVariantNumeric:"tabular-nums",fontFamily:"'Geist Mono',monospace",
                letterSpacing:"-.01em",lineHeight:1,
              }}>{value}</div>
              <div style={{fontSize:"9px",color:"var(--muted2)",marginTop:"4px",fontWeight:"600",textTransform:"uppercase",letterSpacing:".06em"}}>{label}</div>
            </div>
          ))}
        </div>

        {/* Pause / End buttons */}
        <div style={{display:"flex",gap:"8px",width:"100%",maxWidth:"320px"}}>
          <button
            onClick={isPaused ? onResume : onPause}
            style={{
              flex: 1, padding: "15px",
              background: "var(--surface)",
              border: `1.5px solid ${isPaused ? "var(--green)" : "var(--amber)"}`,
              borderRadius: "14px",
              color: isPaused ? "var(--green)" : "var(--amber)",
              fontSize: "14px", fontWeight: "700",
              cursor: "pointer", fontFamily: "'Inter',sans-serif",
              transition: "all var(--tr)",
              boxShadow: "var(--shadow-card)",
            }}
          >
            {isPaused ? "▶ Resume" : "⏸ Pause"}
          </button>
          <button
            onClick={handleEnd}
            style={{
              flex: 2, padding: "15px",
              background: "linear-gradient(180deg, #00A050 0%, #008F44 100%)",
              border: "none", borderRadius: "14px",
              color: "#fff",
              fontSize: "14px", fontWeight: "700",
              cursor: "pointer", fontFamily: "'Inter',sans-serif",
              transition: "all var(--tr)",
              boxShadow: "0 4px 14px rgba(0,143,68,.3), inset 0 1px 0 rgba(255,255,255,.18)",
            }}
          >
            End Shift
          </button>
        </div>

        {/* Nudge */}
        <div style={{
          fontSize: "11px", color: "var(--muted2)", textAlign: "center",
          lineHeight: "1.6", maxWidth: "260px",
        }}>
          Your time is being tracked. Log your earnings after your shift.
        </div>
      </div>
    </div>
  );
}


// ─── WEEKLY TREND HELPERS ───
function getWeekEarnings(trips, weeksAgo) {
  const now = new Date();
  const day = now.getDay();
  const thisMon = new Date(now);
  thisMon.setDate(now.getDate() - (day === 0 ? 6 : day - 1));
  thisMon.setHours(0, 0, 0, 0);
  const start = new Date(thisMon);
  start.setDate(thisMon.getDate() - weeksAgo * 7);
  const end = new Date(start);
  end.setDate(start.getDate() + 7);
  const weekTrips = trips.filter(t => { const d = new Date(t.ts); return d >= start && d < end; });
  return { earned: weekTrips.reduce((s, t) => s + t.totalEarned, 0), shifts: weekTrips.length };
}

function getWeekLabel(weeksAgo) {
  if (weeksAgo === 0) return "This week";
  if (weeksAgo === 1) return "Last week";
  const now = new Date();
  const day = now.getDay();
  const thisMon = new Date(now);
  thisMon.setDate(now.getDate() - (day === 0 ? 6 : day - 1) - weeksAgo * 7);
  return thisMon.toLocaleDateString("en-AU", { day: "2-digit", month: "short" });
}

// ─── TREND CARD (Home Screen) ───
function TrendCard({ trips }) {
  const canvasRef = useRef(null);

  const weeks = [];
  for (let i = 7; i >= 0; i--) {
    const data = getWeekEarnings(trips, i);
    weeks.push({ label: i === 0 ? "Now" : i === 1 ? "Last" : getWeekLabel(i), ...data, current: i === 0 });
  }

  const hasAny = weeks.some(w => w.shifts > 0);
  if (!hasAny) return null;

  const w0 = weeks[7]; // this week
  const w1 = weeks[6]; // last week
  const pctChange = w1.earned > 0 ? ((w0.earned - w1.earned) / w1.earned) * 100 : null;
  const badgeClass = pctChange === null ? "flat" : pctChange >= 0 ? "up" : "down";
  const badgeText  = pctChange === null ? "First week" : `${pctChange >= 0 ? "↑" : "↓"} ${Math.abs(pctChange).toFixed(0)}% vs last`;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.parentElement.clientWidth;
    const H = 100;
    canvas.width = W * dpr; canvas.height = H * dpr;
    canvas.style.width = W + "px"; canvas.style.height = H + "px";
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, H);

    const values = weeks.map(w => w.earned);
    const maxVal = Math.max(...values) * 1.15 || 10;
    const pad = { t: 8, b: 22, l: 4, r: 4 };
    const gW = W - pad.l - pad.r;
    const gH = H - pad.t - pad.b;
    const barW = Math.max(6, (gW / weeks.length) * 0.6);
    const gap  = gW / weeks.length;

    weeks.forEach((w, i) => {
      const val = w.earned;
      const barH = val > 0 ? Math.max(4, (val / maxVal) * gH) : 2;
      const x = pad.l + i * gap + (gap - barW) / 2;
      const y = pad.t + gH - barH;
      const isCurrent = w.current;

      // Bar fill
      if (val > 0) {
        const grad = ctx.createLinearGradient(0, y, 0, y + barH);
        grad.addColorStop(0, isCurrent ? "#22C55E" : "#8B5CF6");
        grad.addColorStop(1, isCurrent ? "#166534" : "#4c1d95");
        ctx.fillStyle = grad;
      } else {
        ctx.fillStyle = "#1C2330";
      }

      // Rounded top corners
      const r = Math.min(3, barW / 2);
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.lineTo(x + barW - r, y);
      ctx.quadraticCurveTo(x + barW, y, x + barW, y + r);
      ctx.lineTo(x + barW, y + barH);
      ctx.lineTo(x, y + barH);
      ctx.lineTo(x, y + r);
      ctx.quadraticCurveTo(x, y, x + r, y);
      ctx.closePath();
      ctx.fill();

      // X-axis label — only show current + every other for space
      if (isCurrent || i === 0 || i % 2 === 0) {
        ctx.fillStyle = isCurrent ? "#22C55E" : "#6B7888";
        ctx.font = `${Math.max(7, Math.min(8, W / 60))}px 'Geist Mono', monospace`;
        ctx.textAlign = "center";
        ctx.fillText(w.label, x + barW / 2, H - 4);
      }
    });
  }, [trips]);

  return (
    <div className="home-card">
      <div className="home-card-row" style={{marginBottom:"10px"}}>
        <div>
          <div className="home-card-label">Earnings Trend</div>
          <div style={{fontSize:"11px",color:"var(--muted2)"}}>Last 8 weeks</div>
        </div>
        <div className={`trend-badge ${badgeClass}`} style={{fontSize:"11px"}}>{badgeText}</div>
      </div>
      <canvas ref={canvasRef} />
    </div>
  );
}

// ─── LIVE DRIVER COUNT (mock data — backend coming soon) ───────────────────
// Generates realistic-feeling driver counts based on region's hourly-rate signal.
// CBDs get more drivers, regional areas fewer. Stable per (zone, 5-min window).
function getMockDriverCount(zoneId) {
  if (!zoneId) return null;
  const base = REGION_BASE[zoneId];
  if (!base) return { total: Math.floor(Math.random() * 6) + 3, ue: 0, dd: 0 };

  // Higher hourly = busier zone = more drivers
  // Map $26-$34 → ~6-25 drivers
  const density = Math.max(0, (base.hourly - 26) / 8); // 0..1
  const baseTotal = Math.round(6 + density * 19);

  // Deterministic-ish jitter using the 5-minute time window so it doesn't flicker
  const window = Math.floor(Date.now() / (5 * 60 * 1000));
  const seed = (zoneId.length * 31 + window) % 1000;
  const rand = () => { const x = Math.sin(seed * (rand.calls = (rand.calls || 0) + 1)) * 10000; return x - Math.floor(x); };
  const jitter = Math.round((rand() - 0.5) * 6); // ±3
  const total = Math.max(2, baseTotal + jitter);

  // UE generally has more drivers than DD in AU; ~60/40 split with noise
  const ueShare = 0.55 + (rand() - 0.5) * 0.15;
  const ue = Math.round(total * ueShare);
  const dd = total - ue;

  return { total, ue, dd };
}

function PlatformPickerModal({ open, onPick, onClose }) {
  if (!open) return null;
  const options = [
    { id: "uber_eats", label: "Uber Eats",      sub: "UE only" },
    { id: "doordash",  label: "DoorDash",       sub: "DD only" },
    { id: "both",      label: "Both platforms", sub: "UE + DD running" },
  ];
  return (
    <div onClick={onClose} style={{
      position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",
      display:"flex",alignItems:"flex-end",justifyContent:"center",
      zIndex:1000,backdropFilter:"blur(4px)",
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background:"var(--surface)",borderTopLeftRadius:"20px",borderTopRightRadius:"20px",
        width:"100%",maxWidth:"480px",padding:"20px 18px 28px",
        boxShadow:"0 -8px 32px rgba(0,0,0,0.3)",
      }}>
        <div style={{width:"36px",height:"4px",background:"var(--border2)",borderRadius:"2px",margin:"0 auto 18px"}} />
        <div style={{fontFamily:"'Inter',sans-serif",fontSize:"18px",fontWeight:"800",color:"var(--text)",letterSpacing:"-.02em",marginBottom:"4px"}}>Going online</div>
        <div style={{fontFamily:"'Inter',sans-serif",fontSize:"12px",color:"var(--muted)",marginBottom:"18px",lineHeight:"1.5"}}>
          Which platform are you driving for right now? Other drivers in your zone will see you.
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:"8px"}}>
          {options.map(o => (
            <button
              key={o.id}
              onClick={() => onPick(o.id)}
              style={{
                background:"var(--elevated)",border:"0.5px solid var(--border)",
                borderRadius:"13px",padding:"14px 16px",cursor:"pointer",
                display:"flex",alignItems:"center",justifyContent:"space-between",
                fontFamily:"'Inter',sans-serif",textAlign:"left",
              }}
            >
              <div>
                <div style={{fontSize:"14px",fontWeight:"700",color:"var(--text)",letterSpacing:"-.005em"}}>{o.label}</div>
                <div style={{fontSize:"11px",color:"var(--muted)",marginTop:"2px"}}>{o.sub}</div>
              </div>
              <div style={{color:"var(--muted2)",fontSize:"18px"}}>›</div>
            </button>
          ))}
        </div>
        <button
          onClick={onClose}
          style={{
            width:"100%",marginTop:"14px",padding:"13px",
            background:"transparent",border:"none",cursor:"pointer",
            color:"var(--muted2)",fontFamily:"'Inter',sans-serif",
            fontSize:"13px",fontWeight:"500",
          }}
        >Cancel</button>
      </div>
    </div>
  );
}

// ─── SIGN-IN MODAL ─── Sends a magic link to the user's email.
function SignInModal({ open, onSendLink, onClose }) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState("idle"); // idle | sending | sent | error
  const [errMsg, setErrMsg] = useState("");

  if (!open) return null;

  const handleSend = async () => {
    const trimmed = email.trim();
    if (!trimmed || !trimmed.includes("@")) {
      setErrMsg("Enter a valid email address");
      setStatus("error");
      return;
    }
    setStatus("sending");
    setErrMsg("");
    const result = await onSendLink(trimmed);
    if (result?.ok) {
      setStatus("sent");
    } else {
      setErrMsg(result?.error?.message || "Couldn't send the link. Check your connection and try again.");
      setStatus("error");
    }
  };

  return (
    <div onClick={onClose} style={{
      position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",
      display:"flex",alignItems:"flex-end",justifyContent:"center",
      zIndex:1000,backdropFilter:"blur(4px)",
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background:"var(--surface)",borderTopLeftRadius:"20px",borderTopRightRadius:"20px",
        width:"100%",maxWidth:"480px",padding:"20px 18px 28px",
        boxShadow:"0 -8px 32px rgba(0,0,0,0.3)",
      }}>
        <div style={{width:"36px",height:"4px",background:"var(--border2)",borderRadius:"2px",margin:"0 auto 18px"}} />

        {status === "sent" ? (
          <>
            <div style={{textAlign:"center",fontSize:"42px",marginBottom:"12px"}}>📬</div>
            <div style={{fontFamily:"'Inter',sans-serif",fontSize:"18px",fontWeight:"800",color:"var(--text)",letterSpacing:"-.02em",marginBottom:"6px",textAlign:"center"}}>Check your email</div>
            <div style={{fontFamily:"'Inter',sans-serif",fontSize:"12px",color:"var(--muted)",marginBottom:"22px",lineHeight:"1.5",textAlign:"center"}}>
              We sent a sign-in link to <strong style={{color:"var(--text)"}}>{email.trim()}</strong>.<br/>
              Click the link to finish signing in.
            </div>
            <button
              onClick={onClose}
              style={{
                width:"100%",padding:"14px",background:"var(--green)",color:"#0B0F14",
                border:"none",borderRadius:"12px",cursor:"pointer",
                fontFamily:"'Inter',sans-serif",fontSize:"14px",fontWeight:"700",
              }}
            >Done</button>
          </>
        ) : (
          <>
            <div style={{fontFamily:"'Inter',sans-serif",fontSize:"18px",fontWeight:"800",color:"var(--text)",letterSpacing:"-.02em",marginBottom:"6px"}}>Sign in to save your data</div>
            <div style={{fontFamily:"'Inter',sans-serif",fontSize:"12px",color:"var(--muted)",marginBottom:"18px",lineHeight:"1.5"}}>
              Enter your email and we'll send a magic sign-in link — no password needed.
              All your existing shifts will be linked to your account.
            </div>

            <div style={{marginBottom:"14px"}}>
              <div style={{fontSize:"10px",fontWeight:"700",color:"var(--muted2)",letterSpacing:".08em",textTransform:"uppercase",marginBottom:"6px"}}>Email address</div>
              <input
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={e => { setEmail(e.target.value); if (status === "error") setStatus("idle"); }}
                onKeyDown={e => { if (e.key === "Enter") handleSend(); }}
                disabled={status === "sending"}
                style={{
                  width:"100%",padding:"13px 14px",
                  background:"var(--elevated)",border:`0.5px solid ${status==="error"?"var(--red-border)":"var(--border)"}`,
                  borderRadius:"11px",color:"var(--text)",
                  fontFamily:"'Inter',sans-serif",fontSize:"15px",
                  fontVariantNumeric:"tabular-nums",
                  outline:"none",
                }}
              />
              {status === "error" && (
                <div style={{fontSize:"11px",color:"var(--red)",marginTop:"6px",fontFamily:"'Inter',sans-serif"}}>{errMsg}</div>
              )}
            </div>

            <button
              onClick={handleSend}
              disabled={status === "sending"}
              style={{
                width:"100%",padding:"14px",
                background: status==="sending" ? "var(--muted2)" : "var(--green)",
                color:"#0B0F14",border:"none",borderRadius:"12px",
                cursor: status==="sending" ? "default" : "pointer",
                fontFamily:"'Inter',sans-serif",fontSize:"14px",fontWeight:"700",
              }}
            >{status === "sending" ? "Sending…" : "Send magic link →"}</button>

            <button
              onClick={onClose}
              style={{
                width:"100%",marginTop:"10px",padding:"13px",
                background:"transparent",border:"none",cursor:"pointer",
                color:"var(--muted2)",fontFamily:"'Inter',sans-serif",
                fontSize:"13px",fontWeight:"500",
              }}
            >Cancel</button>
          </>
        )}
      </div>
    </div>
  );
}

function LiveDriverCard({ region, onGoToSettings, liveStatus, onGoOnline, onGoOffline }) {
  const [tick, setTick] = useState(0); // refresh every 5 min
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 5 * 60 * 1000);
    return () => clearInterval(id);
  }, []);

  if (!region) {
    return (
      <div onClick={onGoToSettings} style={{
        background:"var(--surface)",borderRadius:"14px",padding:"14px 16px",
        boxShadow:"var(--shadow-card)",cursor:"pointer",
        display:"flex",alignItems:"center",gap:"12px",
      }}>
        <div style={{fontSize:"22px",flexShrink:0}}>👥</div>
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontFamily:"'Inter',sans-serif",fontSize:"13px",fontWeight:"700",color:"var(--text)",marginBottom:"2px"}}>See drivers online in your zone</div>
          <div style={{fontSize:"11px",color:"var(--muted)"}}>Set your region in Settings to see live activity.</div>
        </div>
        <div style={{color:"var(--muted2)",fontSize:"18px"}}>›</div>
      </div>
    );
  }

  const count = getMockDriverCount(region);
  const regionInfo = REGIONS.find(r => r.id === region);
  const isOnline = liveStatus?.online === true;
  const myPlatform = liveStatus?.platform;

  // If user is online, bump the displayed totals by 1
  const displayTotal = count.total + (isOnline ? 1 : 0);
  const displayUE = count.ue + (isOnline && (myPlatform === "uber_eats" || myPlatform === "both") ? 1 : 0);
  const displayDD = count.dd + (isOnline && (myPlatform === "doordash"  || myPlatform === "both") ? 1 : 0);

  return (
    <div style={{
      background:"var(--surface)",borderRadius:"16px",padding:"16px",
      boxShadow:"var(--shadow-card)",
      border: isOnline ? "1px solid var(--green-border)" : "0.5px solid var(--border)",
    }}>
      {/* Header row */}
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"14px"}}>
        <div style={{minWidth:0,flex:1}}>
          <div style={{display:"flex",alignItems:"center",gap:"6px",marginBottom:"3px"}}>
            <div style={{
              width:"7px",height:"7px",borderRadius:"50%",
              background: isOnline ? "var(--green)" : "var(--muted2)",
              boxShadow: isOnline ? "0 0 0 3px var(--green-dim)" : "none",
              animation: isOnline ? "pulse 2s ease-in-out infinite" : "none",
              flexShrink:0,
            }} />
            <div style={{fontFamily:"'Inter',sans-serif",fontSize:"10px",fontWeight:"700",letterSpacing:".12em",textTransform:"uppercase",color: isOnline ? "var(--green)" : "var(--muted2)"}}>
              {isOnline ? "You're online" : "Drivers nearby"}
            </div>
          </div>
          <div style={{fontFamily:"'Inter',sans-serif",fontSize:"13px",fontWeight:"700",color:"var(--text)",letterSpacing:"-.005em",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
            {regionInfo?.label || region}
          </div>
        </div>
        <div style={{
          fontFamily:"'Inter',sans-serif",fontSize:"9px",fontWeight:"600",
          color:"var(--muted2)",letterSpacing:".06em",textTransform:"uppercase",
          padding:"3px 7px",background:"var(--elevated)",borderRadius:"5px",
          flexShrink:0,marginLeft:"8px",
        }}>Demo data</div>
      </div>

      {/* Driver count tiles */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:"8px",marginBottom:"14px"}}>
        <div style={{
          background:"var(--elevated)",borderRadius:"11px",padding:"12px 10px",textAlign:"center",
        }}>
          <div style={{fontFamily:"'Inter',sans-serif",fontSize:"22px",fontWeight:"800",color:"var(--text)",letterSpacing:"-.02em",lineHeight:"1",fontVariantNumeric:"tabular-nums"}}>{displayTotal}</div>
          <div style={{fontFamily:"'Inter',sans-serif",fontSize:"10px",color:"var(--muted)",marginTop:"6px",fontWeight:"500"}}>Total online</div>
        </div>
        <div style={{
          background:"var(--elevated)",borderRadius:"11px",padding:"12px 10px",textAlign:"center",
          border: isOnline && (myPlatform === "uber_eats" || myPlatform === "both") ? "1px solid var(--green-border)" : "none",
        }}>
          <div style={{fontFamily:"'Inter',sans-serif",fontSize:"22px",fontWeight:"800",color:"var(--text)",letterSpacing:"-.02em",lineHeight:"1",fontVariantNumeric:"tabular-nums"}}>{displayUE}</div>
          <div style={{fontFamily:"'Inter',sans-serif",fontSize:"10px",color:"var(--muted)",marginTop:"6px",fontWeight:"500"}}>Uber Eats</div>
        </div>
        <div style={{
          background:"var(--elevated)",borderRadius:"11px",padding:"12px 10px",textAlign:"center",
          border: isOnline && (myPlatform === "doordash" || myPlatform === "both") ? "1px solid var(--green-border)" : "none",
        }}>
          <div style={{fontFamily:"'Inter',sans-serif",fontSize:"22px",fontWeight:"800",color:"var(--text)",letterSpacing:"-.02em",lineHeight:"1",fontVariantNumeric:"tabular-nums"}}>{displayDD}</div>
          <div style={{fontFamily:"'Inter',sans-serif",fontSize:"10px",color:"var(--muted)",marginTop:"6px",fontWeight:"500"}}>DoorDash</div>
        </div>
      </div>

      {/* CTA */}
      {isOnline ? (
        <button
          onClick={onGoOffline}
          style={{
            width:"100%",padding:"13px",
            background:"transparent",
            border:"0.5px solid var(--border2)",
            color:"var(--text)",borderRadius:"11px",
            fontFamily:"'Inter',sans-serif",fontSize:"13px",fontWeight:"700",
            cursor:"pointer",letterSpacing:".01em",
          }}
        >Go offline</button>
      ) : (
        <button
          onClick={onGoOnline}
          style={{
            width:"100%",padding:"13px",
            background:"var(--green)",color:"#0B0F14",
            border:"none",borderRadius:"11px",
            fontFamily:"'Inter',sans-serif",fontSize:"13px",fontWeight:"700",
            cursor:"pointer",letterSpacing:".01em",
          }}
        >I'm online →</button>
      )}
    </div>
  );
}

// ─── COMMUNITY BENCHMARK CARD ───
function BenchmarkCard({ region, onGoToSettings }) {
  if (!region) {
    return (
      <div className="benchmark-prompt" onClick={onGoToSettings}>
        <div style={{fontSize:"24px",flexShrink:0}}>📍</div>
        <div>
          <div style={{fontFamily:"'Inter',sans-serif",fontSize:"13px",fontWeight:"700",color:"var(--text)",marginBottom:"2px"}}>See your area's benchmarks</div>
          <div style={{fontSize:"11px",color:"var(--muted)"}}>Set your region in Settings to compare with local drivers.</div>
        </div>
        <div style={{color:"var(--muted2)",fontSize:"18px",marginLeft:"auto",flexShrink:0}}>›</div>
      </div>
    );
  }

  const regionInfo = REGIONS.find(r => r.id === region);
  const benchmark  = getRegionBenchmark(region);
  if (!benchmark) return null;

  const now = new Date();
  const weekLabel = now.toLocaleDateString("en-AU", { day: "2-digit", month: "short" });

  return (
    <div className="benchmark-card">
      <div className="benchmark-header">
        <div>
          <div style={{fontSize:"10px",color:"var(--purple)",letterSpacing:".12em",textTransform:"uppercase",marginBottom:"4px",fontWeight:"700"}}>📍 Local Benchmarks</div>
          <div className="benchmark-region">{regionInfo?.label || region}</div>
          <div className="benchmark-week">Week of {weekLabel} · GigTrack drivers</div>
        </div>
        <div className="benchmark-live-dot" />
      </div>
      <div className="benchmark-stats">
        <div className="benchmark-stat">
          <div className="benchmark-stat-label">Avg/hr</div>
          <div className="benchmark-stat-value">${benchmark.hourly}</div>
        </div>
        <div className="benchmark-stat">
          <div className="benchmark-stat-label">Avg/del</div>
          <div className="benchmark-stat-value">${benchmark.perDel}</div>
        </div>
        <div className="benchmark-stat">
          <div className="benchmark-stat-label">Based on</div>
          <div className="benchmark-stat-value">{benchmark.shifts} shifts</div>
        </div>
      </div>
      <div className="benchmark-footer">
        Based on anonymised GigTrack data · Updates weekly<br/>
        <span style={{color:"var(--blue)"}}>Live regional data activates when Firebase connects</span>
      </div>
    </div>
  );
}

// ─── WEEKLY GOAL CARD ───
function WeeklyGoalCard({ trips, weeklyGoal }) {
  if (!weeklyGoal || weeklyGoal <= 0) return null;
  const { weekStart, weekEnd } = getWeekBounds();
  const weekTrips = trips.filter(t => { const d = new Date(t.ts); return d >= weekStart && d < weekEnd; });
  const earned = weekTrips.reduce((s, t) => s + t.totalEarned, 0);
  const pct = Math.min((earned / weeklyGoal) * 100, 100);
  const remaining = Math.max(weeklyGoal - earned, 0);
  const hit = earned >= weeklyGoal;
  const barColor = hit ? "var(--green)" : pct >= 75 ? "#86efac" : pct >= 40 ? "var(--amber)" : "var(--purple)";

  if (hit) {
    return (
      <div className="goal-card" style={{borderColor:"rgba(74,222,128,.3)",background:"rgba(74,222,128,.05)"}}>
        <div className="goal-celebrate">
          <div className="goal-celebrate-emoji">🎉</div>
          <div className="goal-celebrate-title">Weekly goal smashed!</div>
          <div className="goal-celebrate-sub">You've earned ${earned.toFixed(2)} of your ${weeklyGoal.toFixed(0)} goal this week</div>
        </div>
        <div className="goal-bar-bg" style={{marginTop:"14px"}}>
          <div className="goal-bar" style={{width:"100%",background:"var(--green)"}} />
        </div>
      </div>
    );
  }

  return (
    <div className="goal-card">
      <div className="goal-card-top">
        <div>
          <div className="goal-card-label">Weekly Goal</div>
          <div className="goal-card-earned">${earned.toFixed(2)}</div>
          <div className="goal-card-target">of ${weeklyGoal.toFixed(0)} goal</div>
        </div>
        <div style={{textAlign:"right"}}>
          <div className="goal-card-label">Remaining</div>
          <div style={{fontFamily:"'Inter',sans-serif",fontSize:"20px",fontWeight:"700",color:"var(--text)"}}>${remaining.toFixed(2)}</div>
          <div style={{fontSize:"10px",color:"var(--muted2)",marginTop:"2px"}}>{weekTrips.length} shift{weekTrips.length !== 1 ? "s" : ""} this week</div>
        </div>
      </div>
      <div className="goal-bar-bg">
        <div className="goal-bar" style={{width:`${pct}%`, background: barColor}} />
      </div>
      <div className="goal-bar-info">
        <span style={{color: barColor}} className="goal-pct">{pct.toFixed(0)}% complete</span>
        <span>${weeklyGoal.toFixed(0)} target</span>
      </div>
    </div>
  );
}

// ─── HOME SCREEN ───
function HomeScreen({ user, trips, onNewTrip, onViewLog, onSettings, kmPref, activeShift, onStartTimer, onEndTimer, onPauseTimer, onResumeTimer, onOrderSession, weeklyGoal, onResumeShiftScreen, region, isPro = false, onUpgrade, onLogShift, onDetail, liveStatus = null, onGoOnline, onGoOffline }) {
  const { fyStart } = getFYBounds();
  const { weekStart, weekEnd } = getWeekBounds();
  const fyTrips = trips.filter(t => new Date(t.ts) >= fyStart);
  const weekTrips = trips.filter(t => { const d = new Date(t.ts); return d >= weekStart && d < weekEnd; });
  const fyKm = fyTrips.reduce((s, t) => s + (kmPref === "active" ? t.kmDel : t.totalKm), 0);
  const showWarning = fyKm >= ATO_KM_WARNING;

  const weekEarned = weekTrips.reduce((s, t) => s + t.totalEarned, 0);

  // Weekly stats for the 3-tile row (matches the hero earnings figure)
  const weekActiveHrs  = weekTrips.reduce((s, t) => s + (t.activeMin || 0), 0);
  const weekDeliveries = weekTrips.reduce((s, t) => s + (t.dels || 0), 0);
  const weekAvgPerDel  = weekDeliveries > 0 ? weekEarned / weekDeliveries : null;
  const weekStatHrs    = Math.floor(weekActiveHrs / 60);
  const weekStatMins   = weekActiveHrs % 60;
  const hasWeekData    = weekTrips.length > 0;

  // Week vs last week trend
  const { weekStart: lastStart, weekEnd: lastEnd } = (() => {
    const ls = new Date(weekStart); ls.setDate(ls.getDate() - 7);
    const le = new Date(weekEnd); le.setDate(le.getDate() - 7);
    return { weekStart: ls, weekEnd: le };
  })();
  const lastWeekTrips = trips.filter(t => { const d = new Date(t.ts); return d >= lastStart && d < lastEnd; });
  const lastWeekEarned = lastWeekTrips.reduce((s, t) => s + t.totalEarned, 0);
  const pctChange = lastWeekEarned > 0 ? ((weekEarned - lastWeekEarned) / lastWeekEarned) * 100 : null;

  // Arc gauge target — goal if set, otherwise last week's earnings
  const arcTarget = weeklyGoal > 0
    ? weeklyGoal
    : lastWeekEarned > 0 ? lastWeekEarned : null;
  const arcLabel  = weeklyGoal > 0
    ? `of $${weeklyGoal} weekly goal`
    : lastWeekEarned > 0 ? `vs $${lastWeekEarned.toFixed(0)} last week` : null;

  const whole = Math.floor(weekEarned);
  const cents = String(Math.round((weekEarned - whole) * 100)).padStart(2, "0");

  const goalMet = weeklyGoal > 0 && weekEarned >= weeklyGoal;
  const goalPct = weeklyGoal > 0 ? Math.min((weekEarned / weeklyGoal) * 100, 100) : 0;

  // Arc geometry — half circle, 160×86 viewbox
  const ARC_W = 160; const ARC_H = 86;
  const cx = 80; const cy = 80; const r = 66;
  // Arc path: left end to right end of semicircle
  const arcPath = `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`;
  const arcLen  = Math.PI * r; // half circumference
  const fillPct = arcTarget > 0 ? Math.min(weekEarned / arcTarget, 1) : 0;
  const fillOffset = arcLen * (1 - fillPct);

  return (
    <div className="view active" id="view-home">
      {/* Status bar */}
      <div className="home-status-bar">
        <div className="home-status-name"><GTBrand size={22} fontSize={14} /></div>
        <div className="home-status-right">
          <div className="home-status-dot" style={{background: isPro ? "var(--purple)" : "#2a9d5c"}}></div>
          <div className="home-status-plan">{isPro ? "Pro" : "Free"}</div>
        </div>
      </div>

      <div style={{flex:1,overflowY:"auto",paddingBottom:"96px"}}>
        {/* Hero — Cash App style */}
        <div style={{padding:"14px 22px 4px"}}>
          <div style={{fontSize:"14px",color:"var(--muted)",fontWeight:"400",marginBottom:"0"}}>
            Good {new Date().getHours() < 12 ? "morning" : new Date().getHours() < 17 ? "afternoon" : "evening"},
          </div>
          <div style={{fontSize:"22px",fontWeight:"700",color:"var(--text)",letterSpacing:"-.02em",marginTop:"-2px"}}>
            {user?.name?.split(" ")[0] || "Driver"}
          </div>
        </div>

        <div style={{padding:"22px 22px 4px"}}>
          <div style={{fontSize:"11px",fontWeight:"600",color:"var(--muted2)",letterSpacing:".04em",textTransform:"uppercase",marginBottom:"6px"}}>
            Earned this week
          </div>
          <div style={{fontSize:"56px",fontWeight:"800",color:"var(--text)",letterSpacing:"-.045em",lineHeight:".95",fontVariantNumeric:"tabular-nums"}}>
            ${whole}<span style={{fontSize:"26px",fontWeight:"500",color:"var(--muted2)"}}>.{cents}</span>
          </div>
          {/* Change row */}
          <div style={{display:"flex",alignItems:"center",gap:"10px",marginTop:"12px"}}>
            {pctChange !== null && (
              <>
                <div style={{
                  display:"inline-flex",alignItems:"center",gap:"4px",
                  fontSize:"12px",fontWeight:"700",
                  color: pctChange >= 0 ? "var(--green)" : "var(--red)",
                  background: pctChange >= 0 ? "var(--green-dim)" : "var(--red-dim)",
                  padding:"4px 9px",borderRadius:"8px",
                }}>
                  {pctChange >= 0 ? "▲" : "▼"} ${Math.abs(weekEarned - lastWeekEarned).toFixed(2)}
                </div>
                <div style={{fontSize:"11px",color:"var(--muted2)",fontWeight:"500"}}>
                  {Math.abs(pctChange).toFixed(0)}% vs last week
                </div>
              </>
            )}
            {pctChange === null && trips.length === 0 && (
              <div style={{fontSize:"11px",color:"var(--muted2)",fontWeight:"500"}}>
                Log your first shift to get started
              </div>
            )}
          </div>

          {/* Weekly goal progress bar */}
          {weeklyGoal > 0 && (() => {
            const overGoal = weekEarned > weeklyGoal;
            const basePct = Math.min((weekEarned / weeklyGoal) * 100, 100);
            // Over-goal: bonus is the % beyond goal, also capped at 100% (another full goal's worth)
            const bonusPct = overGoal
              ? Math.min(((weekEarned - weeklyGoal) / weeklyGoal) * 100, 100)
              : 0;
            return (
              <div style={{marginTop:"16px"}}>
                {/* Bar track */}
                <div style={{
                  position:"relative",
                  height:"8px",
                  background:"var(--elevated)",
                  borderRadius:"100px",
                  overflow:"hidden",
                }}>
                  {/* Base green fill */}
                  <div style={{
                    position:"absolute",
                    inset:0,
                    width: `${basePct}%`,
                    background: "linear-gradient(90deg, #22C55E 0%, var(--green) 100%)",
                    borderRadius:"100px",
                    transition:"width .6s cubic-bezier(.4,0,.2,1)",
                  }} />
                  {/* Over-goal darker green overlay */}
                  {overGoal && (
                    <div style={{
                      position:"absolute",
                      inset:0,
                      width: `${bonusPct}%`,
                      background: "linear-gradient(90deg, #065F30 0%, #034D24 100%)",
                      borderRadius:"100px",
                      transition:"width .6s cubic-bezier(.4,0,.2,1)",
                      boxShadow:"inset 0 1px 0 rgba(255,255,255,.1)",
                    }} />
                  )}
                </div>
                {/* Goal text + edit link */}
                <div style={{
                  display:"flex",alignItems:"center",justifyContent:"space-between",
                  marginTop:"8px",fontSize:"11px",
                }}>
                  <div style={{color:"var(--muted2)",fontWeight:"500"}}>
                    {overGoal ? (
                      <><span style={{color:"var(--green)",fontWeight:"700"}}>🎉 Goal smashed!</span> ${(weekEarned - weeklyGoal).toFixed(0)} over</>
                    ) : (
                      <>${(weeklyGoal - weekEarned).toFixed(0)} to go · {basePct.toFixed(0)}% of ${weeklyGoal}</>
                    )}
                  </div>
                  <div
                    onClick={onSettings}
                    style={{
                      color:"var(--green)",fontWeight:"600",cursor:"pointer",
                      fontSize:"11px",
                    }}
                  >
                    Edit goal ›
                  </div>
                </div>
              </div>
            );
          })()}
        </div>
        {hasWeekData && (
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:"8px",padding:"22px 16px 0"}}>
            {[
              {
                label: "Active",
                value: weekActiveHrs > 0 ? (weekStatHrs > 0 ? `${weekStatHrs}h ${weekStatMins}m` : `${weekStatMins}m`) : "—",
                color: "var(--green)", bg: "var(--green-dim)",
                icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>,
              },
              {
                label: "Deliveries",
                value: weekDeliveries > 0 ? String(weekDeliveries) : "—",
                color: "var(--blue)", bg: "var(--blue-dim)",
                icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><rect x="3" y="6" width="18" height="14" rx="2"/><path d="M16 3v6M8 3v6"/></svg>,
              },
              {
                label: "Avg / del",
                value: weekAvgPerDel != null ? `$${weekAvgPerDel.toFixed(2)}` : "—",
                color: "var(--amber)", bg: "var(--amber-dim)",
                icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M12 1v22M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>,
              },
            ].map(({ label, value, color, bg, icon }) => (
              <div key={label} style={{
                background:"var(--surface)",borderRadius:"14px",padding:"14px 12px",
                boxShadow:"var(--shadow-card)",
              }}>
                <div style={{
                  width:"28px",height:"28px",borderRadius:"8px",
                  background: bg, color: color,
                  display:"flex",alignItems:"center",justifyContent:"center",
                  marginBottom:"8px",
                }}>{icon}</div>
                <div style={{fontSize:"17px",fontWeight:"800",color:"var(--text)",letterSpacing:"-.02em",fontVariantNumeric:"tabular-nums",fontFamily:"'Geist Mono',monospace"}}>{value}</div>
                <div style={{fontSize:"10px",color:"var(--muted2)",marginTop:"2px",fontWeight:"500"}}>{label}</div>
              </div>
            ))}
          </div>
        )}

        {/* Active shift banner */}
        {activeShift && (
          <div
            style={{
              margin:"14px 16px 0",padding:"14px 16px",
              background:"linear-gradient(135deg, var(--green) 0%, #00A050 100%)",
              borderRadius:"14px",cursor:"pointer",
              display:"flex",alignItems:"center",justifyContent:"space-between",
              boxShadow:"0 8px 22px -6px rgba(0,143,68,.4)",
            }}
            onClick={onResumeShiftScreen}
          >
            <div>
              <div style={{fontSize:"10px",color:"rgba(255,255,255,.85)",letterSpacing:".1em",textTransform:"uppercase",fontWeight:"700",marginBottom:"4px"}}>
                {activeShift.paused ? "⏸ Shift paused" : "● Shift in progress"}
              </div>
              <div style={{fontSize:"28px",fontWeight:"800",color:"#fff",fontFamily:"'Geist Mono',monospace",letterSpacing:"-.02em",fontVariantNumeric:"tabular-nums"}}>
                {(() => {
                  const ms = activeShift.paused ? activeShift.elapsed : (activeShift.elapsed||0)+(Date.now()-activeShift.resumedAt);
                  const s = Math.floor(ms/1000);
                  const h = Math.floor(s/3600), m = Math.floor((s%3600)/60), sec = s%60;
                  const pad = n => String(n).padStart(2,"0");
                  return `${pad(h)}:${pad(m)}:${pad(sec)}`;
                })()}
              </div>
              <div style={{fontSize:"11px",color:"rgba(255,255,255,.8)",marginTop:"3px"}}>Tap to return to shift</div>
            </div>
            <div style={{fontSize:"22px",color:"rgba(255,255,255,.7)"}}>›</div>
          </div>
        )}

        {/* Live drivers in zone */}
        <div style={{padding:"14px 16px 0"}}>
          <LiveDriverCard
            region={region}
            onGoToSettings={onSettings}
            liveStatus={liveStatus}
            onGoOnline={onGoOnline}
            onGoOffline={onGoOffline}
          />
        </div>

        {/* Benchmarks — Pro only */}
        {isPro && <div style={{padding:"14px 16px 0"}}><BenchmarkCard region={region} onGoToSettings={onSettings} /></div>}

        {/* ATO cap warning */}
        {showWarning && (
          <div style={{margin:"14px 16px 0"}}>
            <div className="warning-banner">
              <div className="warning-banner-icon">⚠️</div>
              <div>
                <div className="warning-banner-title">Approaching ATO km cap</div>
                <div className="warning-banner-text">
                  {fyKm.toFixed(0)}km logged this FY. Cap is {ATO_KM_CAP.toLocaleString()}km — consider switching to the logbook method.
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Log a shift — featured action card */}
        <div style={{padding:"22px 16px 0"}}>
          <div
            onClick={onLogShift}
            style={{
              background:"linear-gradient(135deg, #008F44 0%, #00A050 100%)",
              borderRadius:"16px",padding:"16px 18px",
              display:"flex",alignItems:"center",justifyContent:"space-between",
              cursor:"pointer",
              boxShadow:"0 8px 22px -6px rgba(0,143,68,.4), inset 0 1px 0 rgba(255,255,255,.18)",
            }}
          >
            <div>
              <div style={{fontSize:"15px",fontWeight:"800",color:"#fff",letterSpacing:"-.01em"}}>Log a shift</div>
              <div style={{fontSize:"11px",color:"rgba(255,255,255,.75)",marginTop:"2px"}}>Timer or manual entry</div>
            </div>
            <div style={{
              width:"34px",height:"34px",borderRadius:"11px",
              background:"rgba(255,255,255,.18)",
              display:"flex",alignItems:"center",justifyContent:"center",
              fontSize:"18px",color:"#fff",fontWeight:"600",
            }}>＋</div>
          </div>
        </div>

        {/* Recent Shifts — Cash App-style cards with day badges */}
        {trips.length > 0 && (() => {
          const recent = [...trips]
            .sort((a, b) => new Date(b.ts) - new Date(a.ts))
            .slice(0, 3);
          return (
            <div style={{padding:"22px 16px 0"}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"10px",padding:"0 6px"}}>
                <div style={{fontSize:"14px",fontWeight:"700",color:"var(--text)",letterSpacing:"-.01em"}}>Recent Shifts</div>
                <div onClick={onViewLog} style={{fontSize:"12px",color:"var(--green)",fontWeight:"600",cursor:"pointer"}}>View all →</div>
              </div>
              <div style={{display:"flex",flexDirection:"column",gap:"6px"}}>
                {recent.map(t => {
                  const d = new Date(t.ts);
                  const hh = Math.floor(t.totalHrs);
                  const mm = Math.round((t.totalHrs - hh) * 60);
                  const timeStr = hh > 0 ? `${hh}h ${String(mm).padStart(2,"0")}m` : `${mm}m`;
                  const day = d.getDate();
                  const weekday = d.toLocaleDateString("en-AU", { weekday:"short" }).toUpperCase();
                  return (
                    <div key={t.id} onClick={() => onDetail && onDetail(t.id)} style={{
                      background:"var(--surface)",borderRadius:"14px",padding:"12px 14px",
                      boxShadow:"var(--shadow-card)",
                      display:"flex",alignItems:"center",gap:"12px",cursor:"pointer",
                    }}>
                      {/* Day badge */}
                      <div style={{
                        width:"40px",height:"40px",borderRadius:"12px",
                        background:"var(--green-dim)",
                        display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",
                        flexShrink:0,
                      }}>
                        <div style={{fontSize:"14px",fontWeight:"800",color:"var(--green)",lineHeight:1}}>{day}</div>
                        <div style={{fontSize:"8px",fontWeight:"700",color:"var(--green)",letterSpacing:".08em",marginTop:"2px"}}>{weekday}</div>
                      </div>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontSize:"13px",fontWeight:"600",color:"var(--text)"}}>
                          {d.toLocaleTimeString("en-AU",{hour:"numeric",minute:"2-digit"})} · {timeStr} · {t.dels || 0} deliveries
                        </div>
                        <div style={{fontSize:"11px",color:"var(--muted2)",marginTop:"2px"}}>
                          {t.totalKm.toFixed(1)} km{t.platform ? ` · ${t.platform === "uber_eats" ? "Uber Eats" : t.platform === "doordash" ? "DoorDash" : "Both"}` : ""}
                        </div>
                      </div>
                      <div style={{
                        fontFamily:"'Geist Mono',monospace",fontSize:"16px",fontWeight:"700",
                        color:"var(--text)",fontVariantNumeric:"tabular-nums",
                      }}>
                        {fmt$(t.totalEarned)}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}

// ─── SCREENSHOT PREVIEW STAGE ─── Editable form with parsed + manual fields.
// Renders a large screenshot, editable per-field values with green/red indicators,
// plus a few extras (active km, shift date, notes). Save directly creates a shift.

// Defined OUTSIDE the parent component so it stays stable across renders.
// (Defining it inside causes the input to unmount/remount on every keystroke,
// which loses focus after each character.)
function ScreenshotFieldRow({ icon, label, value, onChange, type = "text", placeholder = "", suffix = "", parsedOk }) {
  return (
    <div style={{
      display:"flex",alignItems:"center",gap:"10px",
      padding:"10px 13px",
      background:"var(--surface)",
      border:`0.5px solid ${parsedOk ? "var(--green-border)" : "var(--border)"}`,
      borderRadius:"11px",
    }}>
      <div style={{
        width:"22px",height:"22px",borderRadius:"50%",flexShrink:0,
        background: parsedOk ? "var(--green-dim)" : "var(--red-dim)",
        color: parsedOk ? "var(--green)" : "var(--red)",
        display:"flex",alignItems:"center",justifyContent:"center",
        fontSize:"12px",fontWeight:"700",
      }}>{icon}</div>
      <div style={{minWidth:"95px",fontFamily:"'Inter',sans-serif",fontSize:"12px",color:"var(--muted)",fontWeight:"500"}}>{label}</div>
      <div style={{flex:1,display:"flex",alignItems:"center",gap:"4px"}}>
        <input
          type={type}
          inputMode={type === "number" ? "decimal" : undefined}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          style={{
            flex:1,minWidth:0,
            background:"transparent",border:"none",outline:"none",
            color:"var(--text)",fontFamily:"'Inter',sans-serif",fontSize:"13px",
            fontWeight:"700",fontVariantNumeric:"tabular-nums",
            textAlign:"right",letterSpacing:"-.005em",padding:0,
          }}
        />
        {suffix && (
          <span style={{fontFamily:"'Inter',sans-serif",fontSize:"11px",color:"var(--muted)",flexShrink:0}}>{suffix}</span>
        )}
      </div>
    </div>
  );
}

function ScreenshotPreviewStage({ parsed, previewUrl, onBack, onSaveDirect }) {
  // Initialise each editable field. Track original parsed value separately
  // so we can show green tick (parsed) or red X (not found, user-entered).
  const todayISO = new Date().toISOString().slice(0, 10);
  const initialDate = parsed.shift_date || todayISO;

  const [totalEarned, setTotalEarned]     = useState(parsed.total_earned != null ? String(parsed.total_earned) : "");
  const [tips, setTips]                   = useState(parsed.tips         != null ? String(parsed.tips)         : "");
  const [bonuses, setBonuses]             = useState(parsed.bonuses      != null ? String(parsed.bonuses)      : "");
  const [deliveries, setDeliveries]       = useState(parsed.deliveries   != null ? String(parsed.deliveries)   : "");
  const [onlineMin, setOnlineMin]         = useState(parsed.online_minutes != null ? String(parsed.online_minutes) : "");
  const [activeMin, setActiveMin]         = useState(parsed.active_minutes != null ? String(parsed.active_minutes) : "");
  const [distanceKm, setDistanceKm]       = useState(parsed.distance_km != null ? String(parsed.distance_km) : "");
  const [activeKm, setActiveKm]           = useState(parsed.active_km   != null ? String(parsed.active_km)   : "");
  const [platform, setPlatform]           = useState(parsed.platform || "");
  const [shiftDate, setShiftDate]         = useState(initialDate);
  const [notes, setNotes]                 = useState("");

  const [zoomed, setZoomed]               = useState(false);

  // Parsed-ness signals (for green tick vs red X indicators)
  const wasParsed = {
    total_earned:   parsed.total_earned   != null,
    tips:           parsed.tips           != null,
    bonuses:        parsed.bonuses        != null,
    deliveries:     parsed.deliveries     != null,
    online_minutes: parsed.online_minutes != null,
    active_minutes: parsed.active_minutes != null,
    distance_km:    parsed.distance_km    != null,
    active_km:      parsed.active_km      != null,
    platform:       parsed.platform       != null,
    shift_date:     parsed.shift_date     != null,
  };

  const parsedCount = Object.values(wasParsed).filter(Boolean).length;
  const totalParseable = Object.keys(wasParsed).length;
  const allFailed = parsedCount === 0;

  const handleSave = () => {
    // Build final values object matching the gt_voice_prefill format + extras
    const finalValues = {};
    const num = (s) => { const v = parseFloat(s); return Number.isFinite(v) ? v : null; };
    const intv = (s) => { const v = parseInt(s, 10); return Number.isFinite(v) ? v : null; };

    if (num(totalEarned) != null) finalValues.earned   = num(totalEarned);
    if (num(tips) != null)        finalValues.tips     = num(tips);
    if (num(bonuses) != null)     finalValues.bonus    = num(bonuses);
    if (intv(deliveries) != null) finalValues.dels     = intv(deliveries);
    if (intv(onlineMin) != null)  finalValues.mins     = intv(onlineMin);
    if (intv(activeMin) != null)  finalValues.activeMin = intv(activeMin);
    if (num(distanceKm) != null)  finalValues.km       = num(distanceKm);
    if (num(activeKm) != null)    finalValues.activeKm = num(activeKm);
    if (platform)                 finalValues.platform = platform;
    if (shiftDate)                finalValues.shiftDate = shiftDate; // YYYY-MM-DD
    if (notes.trim())             finalValues.notes    = notes.trim();

    onSaveDirect(finalValues);
  };

  return (
    <div className="view active">
      <div className="topbar">
        <button className="topbar-back" onClick={onBack}>←</button>
        <div className="topbar-title">Review &amp; save</div>
      </div>
      <div className="scroll-area" style={{padding:"14px 14px 100px"}}>

        {/* Top banner */}
        <div style={{
          background: allFailed ? "var(--red-dim)" : parsedCount === totalParseable ? "var(--green-dim)" : "var(--amber-dim)",
          border: `1px solid ${allFailed ? "var(--red-border)" : parsedCount === totalParseable ? "var(--green-border)" : "var(--amber-border)"}`,
          borderRadius:"12px",padding:"12px 14px",marginBottom:"12px",
          display:"flex",gap:"10px",alignItems:"center",
        }}>
          <div style={{fontSize:"20px",flexShrink:0}}>
            {allFailed ? "❌" : parsedCount === totalParseable ? "✅" : "⚠️"}
          </div>
          <div>
            <div style={{fontFamily:"'Inter',sans-serif",fontSize:"13px",fontWeight:"700",color:"var(--text)",marginBottom:"2px"}}>
              {allFailed ? "Couldn't read screenshot" : `${parsedCount}/${totalParseable} fields detected`}
            </div>
            <div style={{fontFamily:"'Inter',sans-serif",fontSize:"11px",color:"var(--muted)"}}>
              Edit any field, then save. Active km is usually only on Uber Eats.
            </div>
          </div>
        </div>

        {/* Large screenshot — tappable to zoom */}
        {previewUrl && (
          <div
            onClick={() => setZoomed(true)}
            style={{
              borderRadius:"12px",
              border:"0.5px solid var(--border)",marginBottom:"14px",
              overflow:"hidden",background:"var(--elevated)",
              cursor:"pointer",
            }}
          >
            <img
              src={previewUrl}
              alt="Uploaded screenshot"
              style={{display:"block",width:"100%",height:"auto",maxHeight:"480px",objectFit:"contain"}}
            />
            <div style={{
              padding:"6px 0",textAlign:"center",
              fontFamily:"'Inter',sans-serif",fontSize:"10px",
              color:"var(--muted2)",letterSpacing:".04em",
            }}>Tap to enlarge</div>
          </div>
        )}

        {/* Zoom modal */}
        {zoomed && previewUrl && (
          <div
            onClick={() => setZoomed(false)}
            style={{
              position:"fixed",inset:0,background:"rgba(0,0,0,0.92)",
              display:"flex",alignItems:"center",justifyContent:"center",
              zIndex:2000,padding:"20px",cursor:"pointer",
            }}
          >
            <img
              src={previewUrl}
              alt="Screenshot zoomed"
              style={{maxWidth:"100%",maxHeight:"100%",objectFit:"contain"}}
            />
            <div style={{
              position:"absolute",top:"20px",right:"20px",
              width:"40px",height:"40px",borderRadius:"50%",
              background:"rgba(255,255,255,.15)",color:"#fff",
              display:"flex",alignItems:"center",justifyContent:"center",
              fontSize:"20px",fontWeight:"700",
            }}>✕</div>
          </div>
        )}

        {/* Parsed/editable fields */}
        <div style={{display:"flex",flexDirection:"column",gap:"6px",marginBottom:"14px"}}>
          <ScreenshotFieldRow icon={wasParsed.total_earned ? "✓" : "✕"} parsedOk={wasParsed.total_earned}
            label="Total earned" value={totalEarned} onChange={setTotalEarned} type="number" placeholder="0.00" suffix="$" />
          <ScreenshotFieldRow icon={wasParsed.tips ? "✓" : "✕"} parsedOk={wasParsed.tips}
            label="Tips" value={tips} onChange={setTips} type="number" placeholder="0.00" suffix="$" />
          <ScreenshotFieldRow icon={wasParsed.bonuses ? "✓" : "✕"} parsedOk={wasParsed.bonuses}
            label="Bonuses" value={bonuses} onChange={setBonuses} type="number" placeholder="0.00" suffix="$" />
          <ScreenshotFieldRow icon={wasParsed.deliveries ? "✓" : "✕"} parsedOk={wasParsed.deliveries}
            label="Deliveries" value={deliveries} onChange={setDeliveries} type="number" placeholder="0" />
          <ScreenshotFieldRow icon={wasParsed.online_minutes ? "✓" : "✕"} parsedOk={wasParsed.online_minutes}
            label="Online time" value={onlineMin} onChange={setOnlineMin} type="number" placeholder="0" suffix="min" />
          <ScreenshotFieldRow icon={wasParsed.active_minutes ? "✓" : "✕"} parsedOk={wasParsed.active_minutes}
            label="Active time" value={activeMin} onChange={setActiveMin} type="number" placeholder="0" suffix="min" />
          <ScreenshotFieldRow icon={wasParsed.distance_km ? "✓" : "✕"} parsedOk={wasParsed.distance_km}
            label="Total km" value={distanceKm} onChange={setDistanceKm} type="number" placeholder="0.0" suffix="km" />
          <ScreenshotFieldRow icon={wasParsed.active_km ? "✓" : "✕"} parsedOk={wasParsed.active_km}
            label="Active km" value={activeKm} onChange={setActiveKm} type="number" placeholder="0.0" suffix="km" />
        </div>

        {/* Platform picker */}
        <div style={{
          padding:"10px 13px",
          background:"var(--surface)",
          border:`0.5px solid ${wasParsed.platform ? "var(--green-border)" : "var(--border)"}`,
          borderRadius:"11px",marginBottom:"6px",
        }}>
          <div style={{display:"flex",alignItems:"center",gap:"10px",marginBottom:"8px"}}>
            <div style={{
              width:"22px",height:"22px",borderRadius:"50%",flexShrink:0,
              background: wasParsed.platform ? "var(--green-dim)" : "var(--red-dim)",
              color: wasParsed.platform ? "var(--green)" : "var(--red)",
              display:"flex",alignItems:"center",justifyContent:"center",
              fontSize:"12px",fontWeight:"700",
            }}>{wasParsed.platform ? "✓" : "✕"}</div>
            <div style={{fontFamily:"'Inter',sans-serif",fontSize:"12px",color:"var(--muted)",fontWeight:"500"}}>Platform</div>
          </div>
          <div style={{display:"flex",gap:"6px"}}>
            {[
              ["uber_eats", "Uber Eats"],
              ["doordash",  "DoorDash"],
              ["both",      "Both"],
            ].map(([id, label]) => (
              <button
                key={id}
                onClick={() => setPlatform(id)}
                style={{
                  flex:1,padding:"9px 8px",borderRadius:"9px",cursor:"pointer",
                  background: platform === id ? "var(--green-dim)" : "var(--elevated)",
                  border: `0.5px solid ${platform === id ? "var(--green-border)" : "var(--border)"}`,
                  color: platform === id ? "var(--green)" : "var(--muted)",
                  fontFamily:"'Inter',sans-serif",fontSize:"11px",fontWeight:"700",
                }}
              >{label}</button>
            ))}
          </div>
        </div>

        {/* Shift date */}
        <ScreenshotFieldRow icon={wasParsed.shift_date ? "✓" : "✕"} parsedOk={wasParsed.shift_date}
          label="Shift date" value={shiftDate} onChange={setShiftDate} type="date" />

        {/* Notes (optional) */}
        <div style={{
          marginTop:"6px",padding:"10px 13px",
          background:"var(--surface)",
          border:"0.5px solid var(--border)",
          borderRadius:"11px",
        }}>
          <div style={{display:"flex",alignItems:"center",gap:"10px",marginBottom:"6px"}}>
            <div style={{
              width:"22px",height:"22px",borderRadius:"50%",flexShrink:0,
              background:"var(--elevated)",color:"var(--muted)",
              display:"flex",alignItems:"center",justifyContent:"center",
              fontSize:"11px",fontWeight:"700",
            }}>—</div>
            <div style={{fontFamily:"'Inter',sans-serif",fontSize:"12px",color:"var(--muted)",fontWeight:"500"}}>Notes (optional)</div>
          </div>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Anything to remember about this shift…"
            rows={2}
            style={{
              width:"100%",background:"transparent",border:"none",outline:"none",
              color:"var(--text)",fontFamily:"'Inter',sans-serif",fontSize:"12.5px",
              resize:"vertical",padding:0,letterSpacing:"-.005em",
            }}
          />
        </div>

      </div>

      {/* Fixed bottom CTA */}
      <div style={{
        position:"fixed",bottom:0,left:0,right:0,
        background:"linear-gradient(180deg,transparent,var(--bg) 40%)",
        padding:"24px 14px 24px",zIndex:50,
      }}>
        <button
          onClick={handleSave}
          style={{
            width:"100%",padding:"15px",
            background:"var(--green)",color:"#0B0F14",
            border:"none",borderRadius:"13px",cursor:"pointer",
            fontFamily:"'Inter',sans-serif",fontSize:"14px",fontWeight:"700",
          }}
        >Save shift →</button>
      </div>
    </div>
  );
}

// ─── SCREENSHOT IMPORT ─── Parse a shift-summary screenshot via Edge Function + Claude vision.
// Stage 1: pick — user selects an image file
// Stage 2: progress — uploading + AI parsing (animated %)
// Stage 3: preview — per-field green/red indicators + confirm
function ScreenshotImportScreen({ onBack, onParsed }) {
  const [stage, setStage] = useState("pick"); // pick | progress | preview | error
  const [pickedFile, setPickedFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [parsed, setParsed] = useState(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [progressPct, setProgressPct] = useState(0);
  const [progressStep, setProgressStep] = useState("");
  const fileInputRef = useRef(null);

  // Open file picker on mount
  useEffect(() => {
    if (stage === "pick" && fileInputRef.current) {
      // Don't auto-click; let user tap the button
    }
  }, [stage]);

  const handleFilePick = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setErrorMsg("Please choose an image file");
      setStage("error");
      return;
    }
    setPickedFile(file);
    setPreviewUrl(URL.createObjectURL(file));
    startParse(file);
  };

  const startParse = async (file) => {
    setStage("progress");
    setProgressPct(0);
    setProgressStep("Uploading screenshot…");

    // Animate progress while parsing happens in background
    let pct = 0;
    const steps = [
      { at: 10,  text: "Uploading screenshot…" },
      { at: 30,  text: "Asking AI to read it…" },
      { at: 60,  text: "Extracting earnings &amp; time…" },
      { at: 85,  text: "Almost done…" },
    ];
    const animator = setInterval(() => {
      pct = Math.min(pct + 2, 92);
      setProgressPct(pct);
      const step = steps.slice().reverse().find(s => pct >= s.at);
      if (step) setProgressStep(step.text);
    }, 120);

    try {
      const { parseShiftScreenshot } = await import("./screenshotImport.js");
      const result = await parseShiftScreenshot(file);
      clearInterval(animator);

      if (!result.ok) {
        setErrorMsg(result.error || "Failed to parse");
        setStage("error");
        return;
      }

      // Final flourish to 100%
      setProgressPct(100);
      setProgressStep("Done");
      setTimeout(() => {
        setParsed(result.parsed);
        setStage("preview");
      }, 350);

    } catch (e) {
      clearInterval(animator);
      setErrorMsg(e.message || "Unknown error");
      setStage("error");
    }
  };

  const handleConfirm = () => {
    if (!parsed) return;
    onParsed(parsed);
  };

  // ── PICK STAGE ──
  if (stage === "pick") {
    return (
      <div className="view active">
        <div className="topbar">
          <button className="topbar-back" onClick={onBack}>←</button>
          <div className="topbar-title">Import from screenshot</div>
        </div>
        <div className="scroll-area" style={{padding:"24px 18px",display:"flex",flexDirection:"column",alignItems:"center"}}>

          <div style={{
            width:"100%",maxWidth:"360px",
            padding:"32px 20px",textAlign:"center",
            background:"linear-gradient(180deg, var(--green-dim), var(--surface))",
            border:"1px solid var(--green-border)",
            borderRadius:"16px",marginBottom:"22px",
          }}>
            <div style={{fontSize:"42px",marginBottom:"10px"}}>📷</div>
            <div style={{fontFamily:"'Inter',sans-serif",fontSize:"16px",fontWeight:"800",color:"var(--text)",marginBottom:"6px",letterSpacing:"-.01em"}}>
              Pick your shift summary
            </div>
            <div style={{fontFamily:"'Inter',sans-serif",fontSize:"12px",color:"var(--muted)",lineHeight:"1.55"}}>
              Choose a screenshot from Uber Eats or DoorDash showing your final shift totals — earnings, deliveries, time.
            </div>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleFilePick}
            style={{display:"none"}}
          />

          <button
            onClick={() => fileInputRef.current?.click()}
            style={{
              width:"100%",maxWidth:"360px",padding:"15px",
              background:"var(--green)",color:"#0B0F14",
              border:"none",borderRadius:"13px",cursor:"pointer",
              fontFamily:"'Inter',sans-serif",fontSize:"14px",fontWeight:"700",
            }}
          >Pick screenshot from gallery</button>

          <div style={{
            marginTop:"22px",maxWidth:"320px",textAlign:"center",
            fontFamily:"'Inter',sans-serif",fontSize:"11px",
            color:"var(--muted2)",lineHeight:"1.55",
          }}>
            Tip: For best results, use a clean screenshot of the shift-summary screen — not blurred, no other apps overlapping.
          </div>
        </div>
      </div>
    );
  }

  // ── PROGRESS STAGE ──
  if (stage === "progress") {
    return (
      <div className="view active">
        <div className="topbar">
          <div className="topbar-title" style={{marginLeft:"auto",marginRight:"auto"}}>Reading your screenshot</div>
        </div>
        <div className="scroll-area" style={{padding:"40px 18px",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center"}}>

          {/* Circular progress */}
          <div style={{position:"relative",width:"140px",height:"140px",marginBottom:"24px"}}>
            <svg width="140" height="140" viewBox="0 0 140 140" style={{transform:"rotate(-90deg)"}}>
              {/* Background ring */}
              <circle cx="70" cy="70" r="62" fill="none"
                stroke="var(--border)" strokeWidth="8" />
              {/* Progress ring */}
              <circle cx="70" cy="70" r="62" fill="none"
                stroke="var(--green)" strokeWidth="8"
                strokeLinecap="round"
                strokeDasharray={`${2 * Math.PI * 62}`}
                strokeDashoffset={`${2 * Math.PI * 62 * (1 - progressPct / 100)}`}
                style={{transition:"stroke-dashoffset .3s ease"}}
              />
            </svg>
            <div style={{
              position:"absolute",inset:0,
              display:"flex",alignItems:"center",justifyContent:"center",
              fontFamily:"'Inter',sans-serif",fontSize:"32px",fontWeight:"800",
              color:"var(--text)",letterSpacing:"-.02em",
              fontVariantNumeric:"tabular-nums",
            }}>{progressPct}%</div>
          </div>

          <div style={{fontFamily:"'Inter',sans-serif",fontSize:"14px",fontWeight:"600",color:"var(--text)",marginBottom:"8px"}}>
            {progressStep}
          </div>
          <div style={{fontFamily:"'Inter',sans-serif",fontSize:"11px",color:"var(--muted)",textAlign:"center",maxWidth:"260px",lineHeight:"1.5"}}>
            This usually takes 3-5 seconds.
          </div>
        </div>
      </div>
    );
  }

  // ── PREVIEW STAGE — editable form with all parsed values + extra fields ──
  if (stage === "preview" && parsed) {
    return (
      <ScreenshotPreviewStage
        parsed={parsed}
        previewUrl={previewUrl}
        onBack={() => setStage("pick")}
        onSaveDirect={(finalValues) => onParsed(finalValues)}
      />
    );
  }

  // ── ERROR STAGE ──
  if (stage === "error") {
    return (
      <div className="view active">
        <div className="topbar">
          <button className="topbar-back" onClick={onBack}>←</button>
          <div className="topbar-title">Couldn't parse</div>
        </div>
        <div className="scroll-area" style={{padding:"32px 18px",display:"flex",flexDirection:"column",alignItems:"center"}}>
          <div style={{fontSize:"42px",marginBottom:"14px"}}>😕</div>
          <div style={{fontFamily:"'Inter',sans-serif",fontSize:"16px",fontWeight:"700",color:"var(--text)",marginBottom:"6px",textAlign:"center"}}>
            Something went wrong
          </div>
          <div style={{fontFamily:"'Inter',sans-serif",fontSize:"12px",color:"var(--muted)",marginBottom:"24px",textAlign:"center",maxWidth:"320px",lineHeight:"1.55"}}>
            {errorMsg || "We couldn't read this screenshot. Try again with a clearer image."}
          </div>
          <button
            onClick={() => { setStage("pick"); setErrorMsg(""); }}
            style={{
              width:"100%",maxWidth:"320px",padding:"14px",
              background:"var(--green)",color:"#0B0F14",
              border:"none",borderRadius:"13px",cursor:"pointer",
              fontFamily:"'Inter',sans-serif",fontSize:"14px",fontWeight:"700",
            }}
          >Try again</button>
        </div>
      </div>
    );
  }

  return null;
}

// ─── VOICE ENTRY ─── Parses natural speech into shift values.
// Uses Web Speech API (Chrome desktop + Android). iOS Safari doesn't support
// this reliably in PWAs yet — we'll move to Whisper backend on real launch.
function VoiceEntryScreen({ onBack, onParsed }) {
  const [status, setStatus] = useState("idle"); // idle | listening | done | error
  const [transcript, setTranscript] = useState("");
  const [parsed, setParsed] = useState(null);
  const recogRef = useRef(null);

  const parseTranscript = (text) => {
    const t = " " + text.toLowerCase().replace(/[,]/g, " ") + " ";
    const num = (re) => { const m = t.match(re); return m ? parseFloat(m[1]) : null; };

    // Dollar amounts — "55 dollars", "$55", "55 bucks"
    const earned = num(/\$?\s*(\d+(?:\.\d+)?)\s*(?:dollars?|bucks?|\$)/) ?? num(/\$\s*(\d+(?:\.\d+)?)/);
    const tips   = num(/(\d+(?:\.\d+)?)\s*(?:dollars?|bucks?)?\s*(?:in\s+)?tips?\b/);
    const bonus  = num(/(\d+(?:\.\d+)?)\s*(?:dollars?|bucks?)?\s*(?:in\s+)?(?:bonus(?:es)?|promo(?:s|tion)?)/);

    // Km — "28 km", "28 kilometers"
    const km     = num(/(\d+(?:\.\d+)?)\s*(?:km|kms|kilometres?|kilometers?)\b/);

    // Deliveries — "6 deliveries", "6 orders", "6 drops"
    const dels   = num(/(\d+)\s*(?:deliveries|delivery|orders?|drops?|trips?)\b/);

    // Time — "two hours", "1 hour 30 min", "90 minutes", "1h 30m"
    let mins = null;
    const hM = t.match(/(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)\b/);
    const mM = t.match(/(\d+)\s*(?:minutes?|mins?|m)\b/);
    if (hM) mins = (mins || 0) + Math.round(parseFloat(hM[1]) * 60);
    if (mM) mins = (mins || 0) + parseInt(mM[1]);
    // Word numbers — "two hours", "half an hour"
    const words = { one:60, two:120, three:180, four:240, five:300, six:360, half:30 };
    Object.entries(words).forEach(([w,m]) => {
      if (new RegExp(`\\b${w}\\s+(?:hours?|hrs?)\\b`).test(t)) mins = (mins || 0) + m;
      if (w === "half" && /\bhalf\s+(?:an?\s+)?hour\b/.test(t)) mins = (mins || 0) + 30;
    });

    // Platform
    let platform = null;
    if (/\b(doordash|door\s*dash|dd)\b/.test(t)) platform = "doordash";
    if (/\b(uber\s*eats?|uber|ue)\b/.test(t)) platform = platform === "doordash" ? "both" : "uber_eats";
    if (/\bboth\b/.test(t)) platform = "both";

    return { earned, tips, bonus, km, dels, mins, platform };
  };

  const start = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { setStatus("error"); return; }
    const recog = new SR();
    recog.lang = "en-AU";
    recog.interimResults = true;
    recog.continuous = false;
    recog.onresult = (e) => {
      const text = Array.from(e.results).map(r => r[0].transcript).join(" ");
      setTranscript(text);
    };
    recog.onend = () => {
      setStatus("done");
      setParsed(parseTranscript(recog._lastTranscript || transcript));
    };
    recog.onerror = () => setStatus("error");
    // Capture final transcript robustly
    const origOnResult = recog.onresult;
    recog.onresult = (e) => {
      origOnResult(e);
      recog._lastTranscript = Array.from(e.results).map(r => r[0].transcript).join(" ");
    };
    recogRef.current = recog;
    setTranscript("");
    setParsed(null);
    setStatus("listening");
    recog.start();
  };

  const stop = () => recogRef.current?.stop();

  // Auto-start on mount
  useEffect(() => { const t = setTimeout(start, 200); return () => { clearTimeout(t); recogRef.current?.abort?.(); }; }, []);

  const handleConfirm = () => {
    if (!parsed) return;
    onParsed(parsed);
  };

  return (
    <div className="view active">
      <div className="topbar">
        <button className="topbar-back" onClick={onBack}>←</button>
        <div className="topbar-title">Voice entry</div>
      </div>
      <div className="scroll-area" style={{padding:"16px"}}>

        {/* Mic card */}
        <div style={{
          padding:"28px 16px",textAlign:"center",
          background:"linear-gradient(180deg, rgba(59,130,246,.1), var(--surface))",
          border:`1px solid ${status==="listening"?"var(--blue-border)":"var(--border)"}`,
          borderRadius:"16px",marginBottom:"14px",
        }}>
          <div
            onClick={status === "listening" ? stop : start}
            style={{
              width:"72px",height:"72px",borderRadius:"50%",
              background:"var(--blue-dim)",color:"var(--blue)",
              display:"inline-flex",alignItems:"center",justifyContent:"center",
              fontSize:"30px",marginBottom:"12px",cursor:"pointer",
              animation: status === "listening" ? "pulse 1.5s ease-in-out infinite" : "none",
              boxShadow: status === "listening" ? "0 0 0 8px rgba(59,130,246,.15)" : "none",
              transition:"box-shadow .3s ease",
            }}
          >🎤</div>
          <div style={{fontFamily:"'Inter',sans-serif",fontSize:"14px",fontWeight:"700",color:"var(--text)",marginBottom:"4px"}}>
            {status === "idle"      && "Tap mic to start"}
            {status === "listening" && "Listening…"}
            {status === "done"      && "Got it"}
            {status === "error"     && "Couldn't access mic"}
          </div>
          <div style={{fontFamily:"'Inter',sans-serif",fontSize:"11px",color:"var(--muted)"}}>
            {status === "listening" && "Speak naturally. Tap to stop."}
            {status === "done"      && "Tap to record again"}
            {status === "idle"      && 'Say: "55 dollars, 6 deliveries, 28 km on DoorDash"'}
            {status === "error"     && "Check microphone permissions and try again"}
          </div>
        </div>

        {/* Transcript */}
        {transcript && (
          <div style={{marginBottom:"14px"}}>
            <div style={{fontSize:"10px",fontWeight:"700",color:"var(--muted2)",letterSpacing:".08em",textTransform:"uppercase",marginBottom:"8px"}}>You said</div>
            <div style={{
              background:"var(--surface)",border:"0.5px solid var(--border)",borderRadius:"12px",
              padding:"13px 14px",fontSize:"13px",color:"var(--text)",lineHeight:"1.6",fontStyle:"italic",
            }}>"{transcript}"</div>
          </div>
        )}

        {/* Parsed values */}
        {parsed && (
          <>
            <div style={{fontSize:"10px",fontWeight:"700",color:"var(--muted2)",letterSpacing:".08em",textTransform:"uppercase",marginBottom:"8px"}}>Parsed</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"8px",marginBottom:"14px"}}>
              {[
                ["Earnings",   parsed.earned != null ? `$${parsed.earned.toFixed(2)}` : "—"],
                ["Deliveries", parsed.dels != null ? String(parsed.dels) : "—"],
                ["Total km",   parsed.km   != null ? `${parsed.km} km` : "—"],
                ["Duration",   parsed.mins != null ? `${Math.floor(parsed.mins/60)}h ${parsed.mins%60}m` : "—"],
                ["Tips",       parsed.tips != null ? `$${parsed.tips.toFixed(2)}` : "—"],
                ["Bonuses",    parsed.bonus != null ? `$${parsed.bonus.toFixed(2)}` : "—"],
              ].map(([label, val]) => {
                const found = val !== "—";
                return (
                  <div key={label} style={{
                    background:"var(--surface)",
                    border: `0.5px solid ${found ? "var(--green-border)" : "var(--border)"}`,
                    borderRadius:"11px",padding:"12px",
                  }}>
                    <div style={{fontFamily:"'Inter',sans-serif",fontSize:"15px",fontWeight:"700",color: found ? "var(--text)" : "var(--muted2)",fontVariantNumeric:"tabular-nums",letterSpacing:"-.01em",lineHeight:"1"}}>{val}</div>
                    <div style={{fontFamily:"'Inter',sans-serif",fontSize:"10px",color:"var(--muted)",marginTop:"5px",fontWeight:"500"}}>{label}</div>
                  </div>
                );
              })}
            </div>

            {parsed.platform && (
              <div style={{
                background:"var(--green-dim)",border:"0.5px solid var(--green-border)",borderRadius:"10px",
                padding:"10px 13px",fontSize:"11px",color:"var(--green)",fontWeight:"600",marginBottom:"14px",
              }}>
                Platform: {parsed.platform === "uber_eats" ? "Uber Eats" : parsed.platform === "doordash" ? "DoorDash" : "Both"}
              </div>
            )}

            <button
              onClick={handleConfirm}
              style={{
                width:"100%",padding:"15px",background:"var(--green)",color:"#0B0F14",
                border:"none",borderRadius:"13px",
                fontFamily:"'Inter',sans-serif",fontSize:"15px",fontWeight:"700",cursor:"pointer",
              }}
            >Use these values →</button>
            <div style={{textAlign:"center",fontSize:"10px",color:"var(--muted2)",marginTop:"8px",lineHeight:"1.5"}}>
              You'll be able to edit anything on the next screen before saving.
            </div>
          </>
        )}

      </div>
    </div>
  );
}

// ─── LOG A SHIFT SELECTION SCREEN — 3 options ───
function LogShiftScreen({ onBack, onStartTimer, onNewTrip, onVoiceEntry, onScreenshotImport, isPro = false, onUpgrade }) {
  // Detect Web Speech API support
  const voiceSupported = typeof window !== "undefined" &&
    ("webkitSpeechRecognition" in window || "SpeechRecognition" in window);

  return (
    <div className="view active">
      <div className="topbar">
        <button className="topbar-back" onClick={onBack}>←</button>
        <div className="topbar-title">Log a shift</div>
      </div>
      <div className="scroll-area">
        <div className="log-shift-list">

          {/* 1 — Start Shift Timer */}
          <div className="log-entry-card featured" onClick={onStartTimer}>
            <div className="log-entry-icon log-icon-dark">
              <span style={{color:"var(--green)",fontSize:"20px"}}>▶</span>
            </div>
            <div className="log-entry-text">
              <div className="log-entry-title">Start shift timer</div>
              <div className="log-entry-desc">Tap to start timing your shift live. GPS tracks your KMs automatically.</div>
            </div>
            <div className="log-entry-arrow">›</div>
          </div>

          {/* 2 — Voice Entry (only if supported) */}
          {voiceSupported && (
            <div className="log-entry-card" onClick={onVoiceEntry}>
              <div className="log-entry-icon" style={{background:"rgba(59,130,246,.14)",color:"var(--blue)"}}>
                <span style={{fontSize:"22px"}}>🎤</span>
              </div>
              <div className="log-entry-text">
                <div className="log-entry-title">Voice entry</div>
                <div className="log-entry-desc">Speak naturally — "55 dollars, 6 deliveries on DoorDash". We'll fill it in.</div>
              </div>
              <div className="log-entry-arrow">›</div>
            </div>
          )}

          {/* 3 — Screenshot Import */}
          <div className="log-entry-card" onClick={onScreenshotImport}>
            <div className="log-entry-icon" style={{background:"rgba(168,85,247,.14)",color:"var(--purple)"}}>
              <span style={{fontSize:"22px"}}>📷</span>
            </div>
            <div className="log-entry-text">
              <div className="log-entry-title">Import from screenshot</div>
              <div className="log-entry-desc">Upload an Uber Eats or DoorDash summary — we'll read the values for you.</div>
            </div>
            <div className="log-entry-arrow">›</div>
          </div>

          {/* 4 — Manual entry */}
          <div className="log-entry-card" onClick={onNewTrip}>
            <div className="log-entry-icon log-icon-green">
              <span style={{fontSize:"22px"}}>✏️</span>
            </div>
            <div className="log-entry-text">
              <div className="log-entry-title">Enter shift details</div>
              <div className="log-entry-desc">Fill in earnings, time, and KMs yourself. Takes about 30 seconds.</div>
            </div>
            <div className="log-entry-arrow">›</div>
          </div>

        </div>
      </div>
    </div>
  );
}

// ─── PLATFORM PILL ────────────────────────────────────────────────────────
function PlatformPill({ platform }) {
  if (!platform) return <span style={{color:"var(--muted2)",fontSize:"14px",fontWeight:"600"}}>—</span>;

  // Uber Eats SVG logo mark (U shape)
  const UberEatsLogo = () => (
    <svg width="18" height="18" viewBox="0 0 40 40" fill="none">
      <rect width="40" height="40" rx="8" fill="#06C167"/>
      <path d="M20 8C13.4 8 8 13.4 8 20v4.5h5.5V20c0-3.6 2.9-6.5 6.5-6.5s6.5 2.9 6.5 6.5v4.5H32V20c0-6.6-5.4-12-12-12z" fill="white"/>
      <rect x="8" y="24.5" width="24" height="5" rx="1" fill="white"/>
    </svg>
  );

  // DoorDash SVG logo mark (D shape)
  const DoorDashLogo = () => (
    <svg width="18" height="18" viewBox="0 0 40 40" fill="none">
      <rect width="40" height="40" rx="8" fill="#FF3008"/>
      <path d="M12 10h10c5.5 0 10 4.5 10 10s-4.5 10-10 10H12V10zm5 5v10h5c2.8 0 5-2.2 5-5s-2.2-5-5-5h-5z" fill="white"/>
    </svg>
  );

  const LogoItem = ({ Logo, name }) => (
    <div style={{display:"flex",alignItems:"center",gap:"7px"}}>
      {Logo()}
      <span style={{fontSize:"14px",fontWeight:"600",color:"var(--text)"}}>{name}</span>
    </div>
  );

  if (platform === "both") {
    return (
      <div style={{display:"flex",flexDirection:"column",gap:"6px",alignItems:"flex-end"}}>
        <LogoItem Logo={UberEatsLogo} name="Uber Eats" />
        <LogoItem Logo={DoorDashLogo} name="DoorDash" />
      </div>
    );
  }
  if (platform === "uber_eats") return <LogoItem Logo={UberEatsLogo} name="Uber Eats" />;
  if (platform === "doordash")  return <LogoItem Logo={DoorDashLogo} name="DoorDash" />;
  return <span style={{color:"var(--muted2)",fontSize:"14px"}}>—</span>;
}

// ─── NEW / EDIT SHIFT ───
function NewTripScreen({ onBack, onSaved, editTrip, kmPref, atoRate, timerPrefill, targets = DEFAULT_TARGETS, fuelEfficiency, fuelPrice, onFuelSave, onGoToSettings, isPro = false, onUpgrade }) {
  const isEdit = !!editTrip;

  // Format a Date to the value datetime-local inputs expect: "YYYY-MM-DDTHH:MM"
  const toDatetimeLocal = (iso) => {
    const d = iso ? new Date(iso) : new Date();
    const pad = n => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const toTimeStr = (ms) => {
    const d = new Date(ms);
    const pad = n => String(n).padStart(2, "0");
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  // Determine initial shift date — timer prefill or edit
  const initShiftDate = timerPrefill
    ? toDatetimeLocal(timerPrefill.startedAt)
    : toDatetimeLocal(editTrip?.ts);

  // Initial online time from timer prefill
  const initOnlineHrs  = timerPrefill ? String(Math.floor((timerPrefill.totalMin||0) / 60)) : (editTrip ? String(Math.floor((editTrip.totalMin||0)/60)) : "");
  const initOnlineMins = timerPrefill ? String((timerPrefill.totalMin||0) % 60) : (editTrip ? String((editTrip.totalMin||0)%60) : "");
  const initKmFromGps  = timerPrefill?.totalKm ? String(timerPrefill.totalKm.toFixed(2)) : null;

  const [shiftDate, setShiftDate] = useState(initShiftDate);
  // Check for order session prefill
  const orderPrefill = DB.get("gt_order_prefill");
  if (orderPrefill) DB.remove("gt_order_prefill");
  // Check for voice entry prefill
  const voicePrefill = DB.get("gt_voice_prefill");
  if (voicePrefill) DB.remove("gt_voice_prefill");

  const [totalEarned, setTotalEarned] = useState(
    voicePrefill?.earned != null ? String(voicePrefill.earned)
    : orderPrefill ? String(orderPrefill.totalEarned)
    : (editTrip ? String(editTrip.totalEarned) : "")
  );
  const [tip, setTip]     = useState(voicePrefill?.tips != null ? String(voicePrefill.tips) : (editTrip ? String(editTrip.tip) : ""));
  const [bonus, setBonus] = useState(voicePrefill?.bonus != null ? String(voicePrefill.bonus) : (editTrip ? String(editTrip.bonus) : ""));

  // Online Time — total time on shift (h + m, matching Uber Eats / DoorDash "Online" field)
  const [onlineHrs, setOnlineHrs]   = useState(
    voicePrefill?.mins != null ? String(Math.floor(voicePrefill.mins / 60)) : initOnlineHrs
  );
  const [onlineMins, setOnlineMins] = useState(
    voicePrefill?.mins != null ? String(voicePrefill.mins % 60) : initOnlineMins
  );

  const [kmMode, setKmMode]       = useState("total"); // "total" | "odometer"
  const [totalKmInput, setTotalKmInput] = useState(
    voicePrefill?.km != null ? String(voicePrefill.km)
    : (initKmFromGps || (editTrip ? String(editTrip.totalKm) : ""))
  );
  const [odoStart, setOdoStart]   = useState("");
  const [odoEnd, setOdoEnd]       = useState("");
  // Order prefill: km from orders = delivery (active) km, not total km
  const [activeKmInput, setActiveKmInput] = useState(
    orderPrefill ? String(orderPrefill.totalKm.toFixed(1)) : (editTrip?.activeKm ? String(editTrip.activeKm) : "")
  );
  // Active Time — pre-filled from order mins if coming from order session
  const [activeHrsPart, setActiveHrsPart]   = useState(
    orderPrefill ? String(Math.floor((orderPrefill.totalMin||0) / 60)) : (editTrip ? String(Math.floor((editTrip.activeMins||0)/60)) : "")
  );
  const [activeMinsPart, setActiveMinsPart] = useState(
    orderPrefill ? String((orderPrefill.totalMin||0) % 60) : (editTrip ? String((editTrip.activeMins||0)%60) : "")
  );
  const [dels, setDels] = useState(
    voicePrefill?.dels != null ? String(voicePrefill.dels)
    : orderPrefill ? String(orderPrefill.dels)
    : (editTrip ? String(editTrip.dels) : "")
  );
  const [expenses, setExpenses] = useState(editTrip ? String(editTrip.expenses) : "0");
  const [platform, setPlatform] = useState(
    voicePrefill?.platform || orderPrefill?.platform || editTrip?.platform || null
  );
  const [errors, setErrors] = useState({});
  const [valMsg, setValMsg] = useState("");

  const n = (v) => Math.max(0, parseFloat(v) || 0);

  // Base is derived: Total Earned − Tip − Bonus (floored at 0)
  const derivedBase = Math.max(0, n(totalEarned) - n(tip) - n(bonus));

  // Online = total shift duration entered directly in h + m
  const derivedTotalMin = (n(onlineHrs) * 60) + n(onlineMins);

  // Active = active delivery time entered directly in h + m
  const derivedActiveMin = (n(activeHrsPart) * 60) + n(activeMinsPart);

  // Derive total km from whichever mode is active
  const derivedTotalKm = (() => {
    if (kmMode === "odometer") {
      const diff = n(odoEnd) - n(odoStart);
      return diff > 0 ? diff : 0;
    }
    return n(totalKmInput);
  })();

  const calc = computeTrip({
    base: derivedBase, tip: n(tip), bonus: n(bonus),
    tDel: derivedTotalMin, tWait: 0,
    activeMin: derivedActiveMin || null,
    activeKmInput: activeKmInput !== "" ? n(activeKmInput) : null,
    kmDel: derivedTotalKm, kmWait: 0,
    dels: n(dels), expenses: n(expenses),
  }, targets);

  const deductKm = derivedTotalKm;
  const deduction = deductKm * (atoRate || ATO_RATE_PER_KM);

  const validate = () => {
    const e = {};
    if (!totalEarned.trim() || isNaN(parseFloat(totalEarned))) e.totalEarned = true;
    if (derivedTotalMin <= 0) e.onlineTime = true;
    if (kmMode === "total" && (!totalKmInput.trim() || isNaN(parseFloat(totalKmInput)))) e.km = true;
    if (kmMode === "odometer" && (!odoStart.trim() || !odoEnd.trim() || derivedTotalKm <= 0)) e.km = true;
    if (!dels.trim() || isNaN(parseFloat(dels))) e.dels = true;
    setErrors(e);
    if (Object.keys(e).length) {
      const labels = [];
      if (e.totalEarned) labels.push("Total Earned");
      if (e.onlineTime) labels.push("Online Time");
      if (e.km) labels.push("Distance");
      if (e.dels) labels.push("Deliveries");
      setValMsg("Required: " + labels.join(", "));
      return false;
    }
    return true;
  };

  const save = () => {
    if (!validate()) return;
    const inputs = { base: derivedBase, tip: n(tip), bonus: n(bonus), tDel: derivedTotalMin, tWait: 0, activeMin: derivedActiveMin || null, activeKmInput: activeKmInput !== "" ? n(activeKmInput) : null, kmDel: derivedTotalKm, kmWait: 0, dels: n(dels), expenses: n(expenses) };
    const c = computeTrip(inputs);
    const record = {
      id: editTrip?.id || Date.now(),
      ts: shiftDate ? new Date(shiftDate).toISOString() : new Date().toISOString(),
      activeMins: derivedActiveMin || null,
      activeKm: activeKmInput !== "" ? n(activeKmInput) : null,
      platform: platform || null,
      ...inputs, ...c, deduction: derivedTotalKm * (atoRate || ATO_RATE_PER_KM),
    };
    onSaved(record, isEdit);
  };

  const [showFuelModal, setShowFuelModal] = useState(false);
  const [fuelModalEff, setFuelModalEff]   = useState(fuelEfficiency ? String(fuelEfficiency) : "");
  const [fuelModalPr,  setFuelModalPr]    = useState(fuelPrice ? String(fuelPrice) : "");

  const f = (id, err) => `input-field${err ? " err" : ""}`;


  return (
    <div className="view active">
      <div className="topbar">
        <button className="topbar-back" onClick={onBack}>←</button>
        <div className="topbar-title">{isEdit ? "Edit Shift" : "New Shift"}</div>
      </div>
      <div className="scroll-area">

        {/* GPS km pre-fill banner */}
        {initKmFromGps && !orderPrefill && (
          <div className="import-banner">
            <div className="import-banner-icon">📍</div>
            <div className="import-banner-text">
              <div className="import-banner-title">GPS KMs captured</div>
              {initKmFromGps} km tracked by GPS this shift. Review and adjust if needed before saving.
            </div>
          </div>
        )}

        {/* Order session import banner */}
        {orderPrefill && (
          <div className="import-banner">
            <div className="import-banner-icon">📦</div>
            <div className="import-banner-text">
              <div className="import-banner-title">{orderPrefill.dels} orders imported</div>
              Total earned, KMs and deliveries pre-filled from your order session. Add your online/active time to complete the shift.
            </div>
          </div>
        )}

        {/* Shift Date & Time */}
        <div className="section">
          <div className="section-label">Shift Date &amp; Time</div>
          <div className="input-row">
            <div className="input-label">When did this shift take place?</div>
            <input
              className="input-field"
              type="datetime-local"
              value={shiftDate}
              onChange={e => setShiftDate(e.target.value)}
              style={{colorScheme:"dark"}}
            />
          </div>
        </div>

        {/* Earnings */}
        <div className="section">
          <div className="section-label">Earnings</div>
          <div className="input-group">
            <div className="input-row">
              <div className="input-label">Total Earned ($) <span className="req">*</span></div>
              <input className={`input-field${errors.totalEarned ? " err" : ""}`} type="number" min="0" step="0.01" placeholder="0.00" value={totalEarned} onChange={e => { setTotalEarned(e.target.value); setErrors(v => ({...v,totalEarned:false})); }} />
            </div>
            <div className="input-row">
              <div className="input-label">Tip Amount ($)</div>
              <input className="input-field" type="number" min="0" step="0.01" placeholder="0.00" value={tip} onChange={e => setTip(e.target.value)} />
            </div>
            <div className="input-row">
              <div className="input-label">Bonus ($)</div>
              <input className="input-field" type="number" min="0" step="0.01" placeholder="0.00" value={bonus} onChange={e => setBonus(e.target.value)} />
            </div>
            <div className="calc-row">
              <div className="calc-label">Base Pay (auto)</div>
              <div className="calc-value">{fmt$(derivedBase)}</div>
            </div>
            <div className="calc-row" style={{borderTop:"none",paddingTop:0}}>
              <div className="calc-label">Total Earned</div>
              <div className="calc-value" style={{color:"var(--green)"}}>{fmt$(calc.totalEarned)}</div>
            </div>
          </div>
        </div>

        {/* Time */}
        <div className="section">
          <div className="section-label">Time on Shift <span className="req">*</span></div>
          <div className="input-group">

            {/* Online Time */}
            <div>
              <div className="input-label" style={{marginBottom:"8px"}}>
                Online Time <span className="req">*</span>
                <span style={{color:"var(--muted2)",fontSize:"10px",fontWeight:400,marginLeft:"6px"}}>total time on shift</span>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"10px"}}>
                <div className="input-row">
                  <div className="input-label">Hours</div>
                  <input
                    className={`input-field${errors.onlineTime ? " err" : ""}`}
                    type="number" min="0" max="23" placeholder="e.g. 2"
                    value={onlineHrs}
                    onChange={e => { setOnlineHrs(e.target.value); setErrors(v => ({...v,onlineTime:false})); }}
                  />
                </div>
                <div className="input-row">
                  <div className="input-label">Minutes</div>
                  <input
                    className={`input-field${errors.onlineTime ? " err" : ""}`}
                    type="number" min="0" max="59" placeholder="e.g. 2"
                    value={onlineMins}
                    onChange={e => { setOnlineMins(e.target.value); setErrors(v => ({...v,onlineTime:false})); }}
                  />
                </div>
              </div>
              {derivedTotalMin > 0 && (
                <div className="calc-row" style={{marginTop:"6px"}}>
                  <div className="calc-label">Total Online Time</div>
                  <div className="calc-value">{derivedTotalMin} min ({(derivedTotalMin/60).toFixed(1)} hrs)</div>
                </div>
              )}
            </div>

            {/* Active Time */}
            <div style={{borderTop:"1px solid #252530",paddingTop:"14px"}}>
              <div className="input-label" style={{marginBottom:"8px"}}>
                Active Time
                <span style={{color:"var(--muted2)",fontSize:"10px",fontWeight:400,marginLeft:"6px"}}>active delivery time only</span>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"10px"}}>
                <div className="input-row">
                  <div className="input-label">Hours</div>
                  <input
                    className="input-field"
                    type="number" min="0" max="23" placeholder="e.g. 1"
                    value={activeHrsPart}
                    onChange={e => setActiveHrsPart(e.target.value)}
                  />
                </div>
                <div className="input-row">
                  <div className="input-label">Minutes</div>
                  <input
                    className="input-field"
                    type="number" min="0" max="59" placeholder="e.g. 16"
                    value={activeMinsPart}
                    onChange={e => setActiveMinsPart(e.target.value)}
                  />
                </div>
              </div>
              {derivedActiveMin > 0 && derivedTotalMin > 0 && (
                <div style={{fontSize:"11px",color:"var(--muted)",background:"var(--elevated)",borderRadius:"8px",padding:"8px 12px",border:"1px solid #252530",marginTop:"8px"}}>
                  Active Time %: <strong style={{color: derivedActiveMin/derivedTotalMin >= 0.85 ? "var(--green)" : derivedActiveMin/derivedTotalMin >= 0.6 ? "var(--amber)" : "var(--red)"}}>
                    {((derivedActiveMin/derivedTotalMin)*100).toFixed(0)}%
                  </strong> of online time
                </div>
              )}
            </div>

          </div>
        </div>

        {/* Distance */}
        <div className="section">
          <div className="section-label">Distance <span className="req">*</span></div>
          <div className="km-toggle">
            <div className={`km-toggle-btn${kmMode === "total" ? " active" : ""}`} onClick={() => setKmMode("total")}>
              📍 Enter Total KMs
            </div>
            <div className={`km-toggle-btn${kmMode === "odometer" ? " active" : ""}`} onClick={() => setKmMode("odometer")}>
              🔢 Odometer Readings
            </div>
          </div>
          <div className="input-group">
            {kmMode === "total" ? (
              <div className="input-row">
                <div className="input-label">Total KMs Driven <span className="req">*</span></div>
                <input
                  className={`input-field${errors.km ? " err" : ""}`}
                  type="number" min="0" step="0.1" placeholder="e.g. 45.5"
                  value={totalKmInput}
                  onChange={e => { setTotalKmInput(e.target.value); setErrors(v => ({...v, km: false})); }}
                />
              </div>
            ) : (
              <div style={{display:"grid", gridTemplateColumns:"1fr 1fr", gap:"10px"}}>
                <div className="input-row">
                  <div className="input-label">Start Odometer <span className="req">*</span></div>
                  <input
                    className={`input-field${errors.km ? " err" : ""}`}
                    type="number" min="0" step="0.1" placeholder="e.g. 45230"
                    value={odoStart}
                    onChange={e => { setOdoStart(e.target.value); setErrors(v => ({...v, km: false})); }}
                  />
                </div>
                <div className="input-row">
                  <div className="input-label">End Odometer <span className="req">*</span></div>
                  <input
                    className={`input-field${errors.km ? " err" : ""}`}
                    type="number" min="0" step="0.1" placeholder="e.g. 45278"
                    value={odoEnd}
                    onChange={e => { setOdoEnd(e.target.value); setErrors(v => ({...v, km: false})); }}
                  />
                </div>
              </div>
            )}
            <div className="calc-row">
              <div className="calc-label">Total KMs</div>
              <div className="calc-value">{derivedTotalKm > 0 ? `${derivedTotalKm.toFixed(1)} km` : "—"}</div>
            </div>
            {kmMode === "odometer" && derivedTotalKm > 0 && (
              <div style={{fontSize:"11px",color:"var(--muted)",background:"var(--elevated)",borderRadius:"8px",padding:"8px 12px",border:"1px solid #252530"}}>
                💡 {n(odoEnd).toFixed(1)} − {n(odoStart).toFixed(1)} = <strong style={{color:"var(--text)"}}>{derivedTotalKm.toFixed(1)} km</strong> driven this shift
              </div>
            )}

            {/* Optional Active KMs — only affects scoring if entered */}
            <div style={{borderTop:"1px solid #252530",paddingTop:"14px",marginTop:"4px"}}>
              <div className="input-label" style={{marginBottom:"4px"}}>
                Active KMs <span style={{color:"var(--muted2)",fontSize:"10px",fontWeight:400,marginLeft:"6px"}}>optional — used in scoring if entered</span>
              </div>
              <div style={{fontSize:"10px",color:"var(--muted2)",marginBottom:"8px",lineHeight:"1.5"}}>
                KMs driven while actively on a delivery (not repositioning or waiting). If left blank, Active KM% is excluded from your score.
              </div>
              <input
                className="input-field"
                type="number" min="0" step="0.1" placeholder="e.g. 38.2"
                value={activeKmInput}
                onChange={e => setActiveKmInput(e.target.value)}
              />
              {activeKmInput !== "" && derivedTotalKm > 0 && (
                <div style={{fontSize:"11px",color:"var(--muted)",background:"var(--elevated)",borderRadius:"8px",padding:"8px 12px",border:"1px solid #252530",marginTop:"8px"}}>
                  Active KM %: <strong style={{color: n(activeKmInput)/derivedTotalKm >= 0.85 ? "var(--green)" : n(activeKmInput)/derivedTotalKm >= 0.6 ? "var(--amber)" : "var(--red)"}}>
                    {((n(activeKmInput)/derivedTotalKm)*100).toFixed(0)}%
                  </strong> of total KMs
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Activity */}
        <div className="section">
          <div className="section-label">Activity <span className="req">*</span></div>
          <div className="input-group">
            <div className="input-row">
              <div className="input-label">Number of Deliveries <span className="req">*</span></div>
              <input className={f("dels",errors.dels)} type="number" min="0" placeholder="0" value={dels} onChange={e => { setDels(e.target.value); setErrors(v => ({...v,dels:false})); }} />
            </div>
          </div>
        </div>

        {/* Platform */}
        <div className="section">
          <div className="section-label">Platform</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"8px"}}>
            {[
              { id:"uber_eats", label:"Uber Eats", color:"#06C167", bg:"rgba(6,193,103,.12)", border:"rgba(6,193,103,.4)" },
              { id:"doordash",  label:"DoorDash",  color:"#FF3008", bg:"rgba(255,48,8,.12)",  border:"rgba(255,48,8,.35)" },
            ].map(p => {
              const selected = platform === p.id || platform === "both";
              const exactSelected = platform === p.id || platform === "both";
              return (
                <div
                  key={p.id}
                  onClick={() => {
                    if (platform === p.id) {
                      setPlatform(null);
                    } else if (platform === "both") {
                      setPlatform(p.id === "uber_eats" ? "doordash" : "uber_eats");
                    } else if (platform && platform !== p.id) {
                      setPlatform("both");
                    } else {
                      setPlatform(p.id);
                    }
                  }}
                  style={{
                    padding:"13px 14px",borderRadius:"10px",cursor:"pointer",
                    background: exactSelected ? p.bg : "var(--elevated)",
                    border: `1.5px solid ${exactSelected ? p.border : "var(--border)"}`,
                    display:"flex",alignItems:"center",gap:"10px",
                    transition:"all var(--tr)",
                  }}
                >
                  <div style={{
                    width:"10px",height:"10px",borderRadius:"50%",flexShrink:0,
                    background: exactSelected ? p.color : "var(--border2)",
                    transition:"background var(--tr)",
                  }} />
                  <span style={{fontSize:"13px",fontWeight:"600",color: exactSelected ? p.color : "var(--muted)"}}>{p.label}</span>
                </div>
              );
            })}
          </div>
          {platform === "both" && (
            <div style={{marginTop:"8px",fontSize:"11px",color:"var(--muted2)",lineHeight:"1.5"}}>
              Both selected — mixed platform shift
            </div>
          )}
          {!platform && (
            <div style={{marginTop:"8px",fontSize:"11px",color:"var(--muted2)"}}>
              Optional — tap to select
            </div>
          )}
        </div>

        {/* Expenses */}
        <div className="section">
          <div className="section-label">Expenses <span style={{fontSize:"9px",color:"var(--muted)",fontWeight:400}}>(not scored)</span></div>
          <div className="input-group">
            <div className="input-row">
              <div className="input-label">Total Spent ($)</div>
              <input className="input-field" type="number" min="0" step="0.01" value={expenses} onChange={e => setExpenses(e.target.value)} />
            </div>
          </div>
        </div>

        {/* Live Metrics */}
        <div className="metrics-panel">
          <div className="section-label">Live Metrics</div>
          <div className="metrics-grid">
            {[
              ["Hourly Rate", calc.totalHrs > 0 ? fmt$(calc.hourly)+"/hr" : "—"],
              ["$ / Delivery", n(dels) > 0 ? fmt$(calc.perDel) : "—"],
              ["$ / 100km", calc.totalKm > 0 ? fmt$(calc.perKm) : "—"],
              ["Online Time", derivedTotalMin > 0 ? `${derivedTotalMin}m` : "—"],
              ["Active Time", derivedActiveMin > 0 ? `${derivedActiveMin}m` : "—"],
              ["Active Time %", derivedTotalMin > 0 && derivedActiveMin > 0 ? fmtPct((derivedActiveMin/derivedTotalMin)*100) : "—"],
            ].map(([label, val]) => (
              <div className="metric-card" key={label}>
                <div className="metric-card-label">{label}</div>
                <div className="metric-card-value">{val}</div>
              </div>
            ))}
          </div>

          <div className="ratio-grid">
            <RatioBar ratio={calc.ratioH} label={`Hourly (tgt $${targets.hourly}/hr)`} />
            <RatioBar ratio={calc.ratioD} label={`Per Del (tgt $${targets.perDel})`} />
            {calc.ratioK !== null
              ? <RatioBar ratio={calc.ratioK} label={`Active KM% (tgt ${targets.activeKm}%)`} />
              : <div className="ratio-card" style={{opacity:0.4}}>
                  <div className="ratio-card-label">Active KM% (tgt {targets.activeKm}%)</div>
                  <div className="ratio-bar-bg"><div className="ratio-bar" style={{width:"0%",background:"var(--border)"}} /></div>
                  <div className="ratio-value" style={{color:"var(--muted2)",fontSize:"11px"}}>not entered</div>
                </div>
            }
            {calc.ratioA !== null
              ? <RatioBar ratio={calc.ratioA} label={`Active Time% (tgt ${targets.activeTime}%)`} />
              : <div className="ratio-card" style={{opacity:0.4}}>
                  <div className="ratio-card-label">Active Time% (tgt {targets.activeTime}%)</div>
                  <div className="ratio-bar-bg"><div className="ratio-bar" style={{width:"0%",background:"var(--border)"}} /></div>
                  <div className="ratio-value" style={{color:"var(--muted2)",fontSize:"11px"}}>not entered</div>
                </div>
            }
          </div>

          <div className={`score-block ${scoreClass(calc.score)}`}>
            <div>
              <div className="score-label">Shift Score</div>
              <div style={{fontSize:"10px",color:"var(--muted2)",marginTop:"2px"}}>
                {[calc.ratioH, calc.ratioD, calc.ratioK, calc.ratioA].filter(r => r !== null).length} of 4 categories scored
              </div>
            </div>
            <div className="score-num">{fmtPct(calc.score)}</div>
          </div>

          {/* Live ATO deduction */}
          <div className="deduction-card">
            <div>
              <div className="ded-label">Est. ATO Deduction ({ATO_FY_LABEL})</div>
              <div className="ded-value">{fmt$(deduction)}</div>
              <div className="ded-sub">{deductKm.toFixed(1)} km × ${(atoRate||ATO_RATE_PER_KM).toFixed(2)}/km</div>
            </div>
            <div className="ded-icon">🧾</div>
          </div>

          {/* Live fuel cost */}
          <FuelCard
            totalKm={derivedTotalKm}
            totalEarned={calc.totalEarned}
            fuelEfficiency={fuelEfficiency}
            fuelPrice={fuelPrice}
            onSetFuel={() => setShowFuelModal(true)}
          />
        </div>

      </div>
      <div className="save-bar">
        {valMsg && <div className="val-msg show">{valMsg}</div>}
        <button className="btn-save" onClick={save}>{isEdit ? "Save Changes" : "Save Shift"}</button>
      </div>

      {/* Inline Fuel Settings Modal */}
      {showFuelModal && (
        <div className="fuel-modal-overlay" onClick={e => e.target.className === "fuel-modal-overlay" && setShowFuelModal(false)}>
          <div className="fuel-modal">
            <div className="fuel-modal-title">⛽ Fuel Settings</div>
            <div className="fuel-modal-sub">Enter your details below. This saves to your account and applies to all shifts.</div>
            <div className="input-group">
              <div className="input-row">
                <div className="input-label">Fuel efficiency (L/100km)</div>
                <input className="input-field" type="number" min="0" step="0.1" placeholder="e.g. 8.5" value={fuelModalEff} onChange={e => setFuelModalEff(e.target.value)} />
              </div>
              <div className="input-row">
                <div className="input-label">Fuel price ($/L)</div>
                <input className="input-field" type="number" min="0" step="0.01" placeholder="e.g. 2.05" value={fuelModalPr} onChange={e => setFuelModalPr(e.target.value)} />
              </div>
              {parseFloat(fuelModalEff) > 0 && parseFloat(fuelModalPr) > 0 && (
                <div style={{fontSize:"11px",color:"var(--muted2)",padding:"8px 12px",background:"var(--surface)",borderRadius:"8px",border:"1px solid #252530"}}>
                  💡 At these settings, a 50km shift costs ~${((50/100)*parseFloat(fuelModalEff)*parseFloat(fuelModalPr)).toFixed(2)} in fuel.
                </div>
              )}
            </div>
            <div style={{display:"flex",gap:"8px",marginTop:"16px"}}>
              <button className="btn btn-outline" style={{flex:1,padding:"14px"}} onClick={() => setShowFuelModal(false)}>Cancel</button>
              <button className="btn btn-primary" style={{flex:2,padding:"14px"}} onClick={() => {
                const fe = parseFloat(fuelModalEff);
                const fp = parseFloat(fuelModalPr);
                if (!isNaN(fe) && fe > 0) onFuelSave(fe, fp > 0 ? fp : fuelPrice);
                if (!isNaN(fp) && fp > 0) onFuelSave(fuelEfficiency, fp);
                if (!isNaN(fe) && fe > 0 && !isNaN(fp) && fp > 0) onFuelSave(fe, fp);
                setShowFuelModal(false);
              }}>Save &amp; Apply</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── WEEKLY TREND CHART ───
function WeeklyTrendChart({ trips }) {
  const canvasRef = useRef(null);
  const weeks = [];
  for (let i = 7; i >= 0; i--) {
    const data = getWeekEarnings(trips, i);
    const lbl = i === 0 ? "This wk" : i === 1 ? "Last wk" : getWeekLabel(i);
    weeks.push({ label: lbl, ...data });
  }
  const hasAny = weeks.some(w => w.shifts > 0);
  if (!hasAny) return <div className="stats-empty">Log shifts across multiple weeks to see your trend.</div>;

  const thisWeek = weeks[7];
  const lastWeek = weeks[6];
  const pctChange = lastWeek.earned > 0 ? ((thisWeek.earned - lastWeek.earned) / lastWeek.earned) * 100 : null;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.parentElement.clientWidth;
    const H = 160;
    canvas.width = W * dpr; canvas.height = H * dpr;
    canvas.style.width = W + "px"; canvas.style.height = H + "px";
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, H);
    const values = weeks.map(w => w.earned);
    const maxVal = Math.max(...values) * 1.2 || 10;
    const pad = { t: 14, b: 36, l: 46, r: 8 };
    const gW = W - pad.l - pad.r;
    const gH = H - pad.t - pad.b;
    const barW = Math.max(6, (gW / weeks.length) * 0.55);
    const gap  = gW / weeks.length;
    [0, 0.25, 0.5, 0.75, 1].forEach(f => {
      const y = pad.t + gH * (1 - f);
      ctx.strokeStyle = "#2A3441"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(W - pad.r, y); ctx.stroke();
      ctx.fillStyle = "#6B7888"; ctx.font = `${Math.max(8,Math.min(9,W/45))}px 'Geist Mono',monospace`;
      ctx.textAlign = "right";
      ctx.fillText("$" + Math.round(maxVal * f), pad.l - 4, y + 3);
    });
    weeks.forEach((w, i) => {
      const val = w.earned;
      const barH = Math.max(val > 0 ? 4 : 2, (val / maxVal) * gH);
      const x = pad.l + i * gap + (gap - barW) / 2;
      const y = pad.t + gH - barH;
      const isCurrent = i === 7;
      if (val > 0) {
        const grad = ctx.createLinearGradient(0, y, 0, y + barH);
        grad.addColorStop(0, isCurrent ? "#22C55E" : "#8B5CF6");
        grad.addColorStop(1, isCurrent ? "#166534" : "#4c1d95");
        ctx.fillStyle = grad;
      } else { ctx.fillStyle = "#1C2330"; }
      const r = Math.min(4, barW / 2);
      const bH = Math.max(barH, 3);
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.lineTo(x + barW - r, y);
      ctx.quadraticCurveTo(x + barW, y, x + barW, y + r);
      ctx.lineTo(x + barW, y + bH);
      ctx.lineTo(x, y + bH);
      ctx.lineTo(x, y + r);
      ctx.quadraticCurveTo(x, y, x + r, y);
      ctx.closePath();
      ctx.fill();
      if (val > 0 && barH > 16) {
        ctx.fillStyle = "#E6EAF0"; ctx.font = `bold ${Math.max(7,Math.min(9,W/50))}px 'Inter',sans-serif`;
        ctx.textAlign = "center";
        ctx.fillText("$" + val.toFixed(0), x + barW / 2, y - 4);
      }
      ctx.fillStyle = isCurrent ? "#22C55E" : "#6B7888";
      ctx.font = `${Math.max(7,Math.min(8,W/52))}px 'Geist Mono',monospace`;
      ctx.textAlign = "center";
      ctx.fillText(w.label, x + barW / 2, H - pad.b + 14);
    });
  }, [trips]);

  return (
    <div>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"12px"}}>
        <div style={{fontFamily:"'Inter',sans-serif",fontSize:"13px",fontWeight:"700",color:"var(--text)"}}>Last 8 Weeks</div>
        {pctChange !== null && (
          <div style={{fontFamily:"'Inter',sans-serif",fontSize:"12px",fontWeight:"700",padding:"4px 10px",borderRadius:"20px",
            background: pctChange>=0?"rgba(74,222,128,.1)":"rgba(248,113,113,.1)",
            color: pctChange>=0?"var(--green)":"var(--red)",
            border:`1px solid ${pctChange>=0?"rgba(74,222,128,.25)":"rgba(248,113,113,.25)"}`}}>
            {pctChange>=0?"↑":"↓"} {Math.abs(pctChange).toFixed(0)}% vs last week
          </div>
        )}
      </div>
      <canvas ref={canvasRef} />
      <div style={{display:"flex",gap:"12px",marginTop:"10px",fontSize:"10px",color:"var(--muted2)"}}>
        <span style={{display:"flex",alignItems:"center",gap:"4px"}}><span style={{width:"10px",height:"10px",background:"#8B5CF6",borderRadius:"2px",display:"inline-block"}}/> Previous</span>
        <span style={{display:"flex",alignItems:"center",gap:"4px"}}><span style={{width:"10px",height:"10px",background:"#22C55E",borderRadius:"2px",display:"inline-block"}}/> This week</span>
      </div>
    </div>
  );
}

// ─── STATS TILE ───
const PERIODS = [
  { id: "lifetime", label: "Lifetime" },
  { id: "fy",      label: "FY " + ATO_FY_LABEL },
  { id: "ytd",     label: "YTD" },
  { id: "monthly", label: "Monthly" },
  { id: "weekly",  label: "Weekly" },
];

function StatsTile({ trips, kmPref, fuelEfficiency, fuelPrice }) {
  const [period, setPeriod] = useState("lifetime");
  const filtered = filterTrips(trips, period);
  const s = computeStats(filtered, kmPref);

  return (
    <div className="stats-tile">
      <div className="stats-tile-header">
        <div className="stats-tile-title">📊 Stats</div>
        <div className="period-tabs">
          {PERIODS.map(p => (
            <div key={p.id} className={`period-tab${period === p.id ? " active" : ""}`} onClick={() => setPeriod(p.id)}>{p.label}</div>
          ))}
        </div>
      </div>
      <div className="stats-tile-body">
        {!s ? (
          <div className="stats-empty">No shifts logged for this period yet.</div>
        ) : (
          <div className="stats-grid">
            {/* Score */}
            <div className="stat-item wide">
              <div className="stat-label">AVG SHIFT SCORE</div>
              <div className="stat-value" style={{color: scoreColor(s.avgScore)}}>{s.avgScore.toFixed(1)}%</div>
              <div className="stat-score-bar-bg">
                <div className="stat-score-bar" style={{width: Math.min((s.avgScore/150)*100,100)+"%", background: scoreColor(s.avgScore)}} />
              </div>
            </div>
            <div className="stat-item"><div className="stat-label">BEST SCORE</div><div className="stat-value" style={{color:"var(--green)"}}>{s.bestScore.toFixed(1)}%</div></div>
            <div className="stat-item"><div className="stat-label">TOTAL SHIFTS</div><div className="stat-value">{s.n}</div></div>

            <div className="stats-section-divider">Earnings</div>
            <div className="stat-item wide"><div className="stat-label">TOTAL EARNED</div><div className="stat-value" style={{color:"var(--green)"}}>{fmt$(s.totalEarned)}</div></div>
            <div className="stat-item"><div className="stat-label">AVG / SHIFT</div><div className="stat-value">{fmt$(s.totalEarned/s.n)}</div></div>
            <div className="stat-item"><div className="stat-label">AVG HOURLY</div><div className="stat-value">{s.totalHrs > 0 ? fmt$(s.totalEarned/s.totalHrs)+"/hr" : "—"}</div></div>
            <div className="stat-item"><div className="stat-label">AVG / DELIVERY</div><div className="stat-value">{s.totalDels > 0 ? fmt$(s.totalEarned/s.totalDels) : "—"}</div></div>
            {fuelEfficiency > 0 && fuelPrice > 0 && (() => {
              const totalFuel = (s.totalKm / 100) * fuelEfficiency * fuelPrice;
              const netEarned = s.totalEarned - totalFuel;
              return (<>
                <div className="stat-item"><div className="stat-label">FUEL COST</div><div className="stat-value" style={{color:"var(--red)"}}>−{fmt$(totalFuel)}</div></div>
                <div className="stat-item"><div className="stat-label">NET (AFTER FUEL)</div><div className="stat-value" style={{color:"var(--green)"}}>{fmt$(netEarned)}</div></div>
              </>);
            })()}

            <div className="stats-section-divider">Time & Distance</div>
            <div className="stat-item"><div className="stat-label">TOTAL HOURS</div><div className="stat-value">{s.totalHrs.toFixed(1)} hrs</div></div>
            <div className="stat-item"><div className="stat-label">TOTAL KMs</div><div className="stat-value">{s.totalKm.toFixed(1)} km</div></div>
            <div className="stat-item"><div className="stat-label">TOTAL DELIVERIES</div><div className="stat-value">{s.totalDels}</div></div>
            <div className="stat-item"><div className="stat-label">DAYS WORKED</div><div className="stat-value">{s.daysWorked}</div></div>

            {/* ATO Deduction */}
            <div className="stats-section-divider">ATO Deduction ({ATO_FY_LABEL})</div>
            <div className="ded-stat">
              <div className="ded-stat-label">EST. DEDUCTION — CENTS PER KM METHOD</div>
              <div className="ded-stat-value">{fmt$(s.deduction)}</div>
              <div className="ded-stat-sub">{s.deductKm.toFixed(1)} business km × ${ATO_RATE_PER_KM.toFixed(2)}/km · cap {ATO_KM_CAP.toLocaleString()}km/yr · {kmPref === "active" ? "delivery km only" : "all shift km"}</div>
            </div>

            {s.totalExp > 0 && (
              <>
                <div className="stats-section-divider">Expenses</div>
                <div className="stat-item wide"><div className="stat-label">TOTAL SPENT ON SHIFTS</div><div className="stat-value" style={{color:"var(--accent2)"}}>{fmt$(s.totalExp)}</div></div>
              </>
            )}
          </div>
        )}

        {/* Hall of Fame — Lifetime tab only */}
        {period === "lifetime" && trips.length >= 2 && (() => {
          const fmtDate = iso => new Date(iso).toLocaleDateString("en-AU", {day:"2-digit",month:"short",year:"numeric"});

          const bestScore   = trips.reduce((b,t) => t.score > b.score ? t : b, trips[0]);
          const bestEarned  = trips.reduce((b,t) => t.totalEarned > b.totalEarned ? t : b, trips[0]);
          const bestHourly  = trips.filter(t=>t.totalHrs>0).reduce((b,t) => t.hourly > b.hourly ? t : b, trips.filter(t=>t.totalHrs>0)[0]);
          const bestDels    = trips.filter(t=>t.dels>0).reduce((b,t) => t.dels > b.dels ? t : b, trips.filter(t=>t.dels>0)[0]);

          const records = [
            { icon:"🏆", label:"Highest Score", value: bestScore.score.toFixed(1)+"%", date: fmtDate(bestScore.ts), color:"gold" },
            { icon:"💰", label:"Best Earning Shift", value: fmt$(bestEarned.totalEarned), date: fmtDate(bestEarned.ts), color:"green" },
            { icon:"⚡", label:"Best Hourly Rate", value: bestHourly ? fmt$(bestHourly.hourly)+"/hr" : "—", date: bestHourly ? fmtDate(bestHourly.ts) : "", color:"purple" },
            { icon:"📦", label:"Most Deliveries", value: bestDels ? bestDels.dels+" orders" : "—", date: bestDels ? fmtDate(bestDels.ts) : "", color:"teal" },
          ];

          return (
            <div className="hof-section">
              <div className="hof-title">🏅 Personal Records</div>
              <div className="hof-grid">
                {records.map(r => (
                  <div key={r.label} className={`hof-card ${r.color}`}>
                    <div className="hof-card-icon">{r.icon}</div>
                    <div className="hof-card-label">{r.label}</div>
                    <div className="hof-card-value">{r.value}</div>
                    {r.date && <div className="hof-card-date">{r.date}</div>}
                  </div>
                ))}
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}

// ─── BAR CHART ───
function DailyBarChart({ trips }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    if (!trips.length) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.parentElement.clientWidth - 32;
    const H = 160;
    canvas.width = W * dpr; canvas.height = H * dpr;
    canvas.style.width = W + "px"; canvas.style.height = H + "px";
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, H);

    const dayMap = {};
    trips.forEach(t => {
      const d = new Date(t.ts);
      const sortKey = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
      if (!dayMap[sortKey]) dayMap[sortKey] = { display: d.toLocaleDateString("en-CA", { month: "numeric", day: "numeric" }), total: 0 };
      dayMap[sortKey].total += t.totalEarned;
    });

    const days = Object.keys(dayMap).sort().slice(-10);
    if (!days.length) return;

    const values = days.map(d => dayMap[d].total);
    const labels = days.map(d => dayMap[d].display);
    const maxVal = Math.max(...values) * 1.2 || 10;
    const pad = { t: 14, b: 36, l: 48, r: 8 };
    const gW = W - pad.l - pad.r;
    const gH = H - pad.t - pad.b;
    const barW = Math.max(8, (gW / days.length) * 0.55);
    const gap  = gW / days.length;

    // Grid lines — use hardcoded brand hex (CSS vars don't work in canvas)
    [0, 0.25, 0.5, 0.75, 1].forEach(f => {
      const y = pad.t + gH * (1 - f);
      ctx.strokeStyle = "#2A3441"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(W - pad.r, y); ctx.stroke();
      ctx.fillStyle = "#6B7888";
      ctx.font = `${Math.max(8, Math.min(9, W/45))}px 'Geist Mono', monospace`;
      ctx.textAlign = "right";
      ctx.fillText("$" + Math.round(maxVal * f), pad.l - 5, y + 3);
    });

    days.forEach((day, i) => {
      const val = values[i];
      const barH = Math.max(2, (val / maxVal) * gH);
      const x = pad.l + i * gap + (gap - barW) / 2;
      const y = pad.t + gH - barH;
      const grad = ctx.createLinearGradient(0, y, 0, y + barH);
      grad.addColorStop(0, "#22C55E");
      grad.addColorStop(1, "#166534");
      ctx.fillStyle = grad;
      // Rounded top corners — polyfill for environments without roundRect
      const r = Math.min(4, barW / 2);
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.lineTo(x + barW - r, y);
      ctx.quadraticCurveTo(x + barW, y, x + barW, y + r);
      ctx.lineTo(x + barW, y + barH);
      ctx.lineTo(x, y + barH);
      ctx.lineTo(x, y + r);
      ctx.quadraticCurveTo(x, y, x + r, y);
      ctx.closePath();
      ctx.fill();
      // Value label
      ctx.fillStyle = "#E6EAF0";
      ctx.font = `bold ${Math.max(8, Math.min(9, W/50))}px 'Inter', sans-serif`;
      ctx.textAlign = "center";
      if (barH > 18) ctx.fillText("$" + val.toFixed(0), x + barW / 2, y - 4);
      // X-axis label
      ctx.fillStyle = "#6B7888";
      ctx.font = `${Math.max(7, Math.min(9, W/50))}px 'Geist Mono', monospace`;
      ctx.fillText(labels[i], x + barW / 2, H - pad.b + 14);
    });
  }, [trips]);

  if (!trips.length) return null;
  return (
    <div className="chart-section">
      <div className="chart-title">Daily Earnings — Last 10 Days</div>
      <div className="chart-wrap"><canvas ref={canvasRef} height="160" /></div>
    </div>
  );
}

// ─── PDF EXPORT ─── (ATO-focused shift log report)
function exportPDF(trips, user) {
  if (!trips.length) {
    alert("No shifts to export yet. Log a shift first.");
    return;
  }
  const { fyStart, fyEnd } = getFYBounds();
  const fyTrips = trips.filter(t => { const d = new Date(t.ts); return d >= fyStart && d < fyEnd; });

  // If no shifts fall inside the current FY, fall back to all-time
  const useFY = fyTrips.length > 0;
  const reportTrips = useFY ? fyTrips : trips;
  const sorted = [...reportTrips].sort((a, b) => new Date(a.ts) - new Date(b.ts));

  // Totals
  const totalEarned   = reportTrips.reduce((s, t) => s + (t.totalEarned || 0), 0);
  const totalBase     = reportTrips.reduce((s, t) => s + (t.base || 0), 0);
  const totalTips     = reportTrips.reduce((s, t) => s + (t.tip || 0), 0);
  const totalBonuses  = reportTrips.reduce((s, t) => s + (t.bonus || 0), 0);
  const totalTotalKm  = reportTrips.reduce((s, t) => s + (t.totalKm || 0), 0);
  const totalActiveKm = reportTrips.reduce((s, t) => s + (t.kmDel || t.activeKm || 0), 0);
  const totalDels     = reportTrips.reduce((s, t) => s + (t.dels || 0), 0);
  const totalHrs      = reportTrips.reduce((s, t) => s + (t.totalHrs || 0), 0);

  // ATO deduction — use total km, capped at the FY 5000km limit
  const cappedKm    = Math.min(totalTotalKm, ATO_KM_CAP);
  const totalDed    = cappedKm * ATO_RATE_PER_KM;
  const estTaxSaved = totalDed * 0.325; // estimate at common 32.5% marginal rate

  const fmtD = iso => new Date(iso).toLocaleDateString("en-AU", { day:"2-digit", month:"short", year:"numeric" });
  const fmtT = iso => new Date(iso).toLocaleTimeString("en-AU", { hour:"numeric", minute:"2-digit" });
  const fmtMoney = v => `$${(v || 0).toFixed(2)}`;

  // Table rows
  const rows = sorted.map((t, i) => {
    const platName = t.platform === "uber_eats" ? "Uber Eats" : t.platform === "doordash" ? "DoorDash" : "—";
    const dur = (() => {
      const m = Math.round((t.totalHrs || 0) * 60);
      return `${Math.floor(m/60)}h ${m%60}m`;
    })();
    const tripDed = (t.totalKm || 0) * ATO_RATE_PER_KM;
    return `<tr>
      <td class="num">${i+1}</td>
      <td>${fmtD(t.ts)}</td>
      <td>${fmtT(t.ts)}</td>
      <td>${platName}</td>
      <td class="num">${dur}</td>
      <td class="num">${(t.totalKm || 0).toFixed(1)}</td>
      <td class="num">${t.dels || 0}</td>
      <td class="num">${fmtMoney(t.base)}</td>
      <td class="num">${fmtMoney(t.tip)}</td>
      <td class="num">${fmtMoney(t.bonus)}</td>
      <td class="num strong">${fmtMoney(t.totalEarned)}</td>
      <td class="num ded">${fmtMoney(tripDed)}</td>
    </tr>`;
  }).join("");

  const periodLabel = useFY
    ? `FY ${ATO_FY_LABEL} · ${fmtD(fyStart.toISOString())} – ${fmtD(new Date(fyEnd.getTime()-86400000).toISOString())}`
    : `All-time · ${fmtD(sorted[0].ts)} – ${fmtD(sorted[sorted.length-1].ts)}`;

  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<title>GigTrack — ATO Shift Report</title>
<style>
*{box-sizing:border-box;margin:0;padding:0;}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;font-size:11px;color:#0F172A;background:#fff;padding:32px;}

/* Header */
.header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:22px;padding-bottom:16px;border-bottom:2px solid #22C55E;}
.brand-block{display:flex;align-items:center;gap:10px;}
.brand-logo{width:32px;height:32px;background:linear-gradient(135deg,#22C55E,#16A34A);border-radius:8px;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:14px;}
.brand-name{font-size:22px;font-weight:800;color:#0F172A;letter-spacing:-.02em;}
.brand-tag{font-size:10px;color:#64748B;letter-spacing:.04em;margin-top:1px;}
.header-right{text-align:right;font-size:10px;color:#64748B;line-height:1.6;}
.header-right strong{display:block;color:#0F172A;font-size:13px;font-weight:700;margin-bottom:2px;}

/* Period banner */
.period{background:#F0FDF4;border:1px solid #BBF7D0;border-radius:8px;padding:8px 14px;font-size:10px;color:#15803D;margin-bottom:18px;font-weight:600;letter-spacing:.02em;}

/* Hero squares */
.hero-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:14px;}
.hero{border:1px solid #E2E8F0;border-radius:10px;padding:14px 14px 12px;background:#fff;position:relative;overflow:hidden;}
.hero::before{content:"";position:absolute;left:0;top:0;bottom:0;width:3px;}
.hero.h-green::before{background:#22C55E;}
.hero.h-blue::before{background:#3B82F6;}
.hero.h-amber::before{background:#F59E0B;}
.hero.h-purple::before{background:#A855F7;}
.hero-label{font-size:9px;color:#64748B;letter-spacing:.08em;text-transform:uppercase;margin-bottom:6px;font-weight:600;}
.hero-value{font-size:20px;font-weight:800;color:#0F172A;letter-spacing:-.02em;line-height:1;}
.hero-sub{font-size:9px;color:#64748B;margin-top:5px;}
.hero.h-green .hero-value{color:#15803D;}
.hero.h-blue .hero-value{color:#1D4ED8;}
.hero.h-amber .hero-value{color:#B45309;}

/* Mini summary row */
.mini-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:22px;}
.mini{background:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px;padding:10px 12px;}
.mini-label{font-size:9px;color:#64748B;letter-spacing:.06em;text-transform:uppercase;margin-bottom:3px;font-weight:600;}
.mini-value{font-size:13px;font-weight:700;color:#0F172A;}

/* Table */
.section-title{font-size:12px;font-weight:700;color:#0F172A;margin-bottom:8px;letter-spacing:-.01em;}
table{width:100%;border-collapse:collapse;font-size:9.5px;margin-bottom:18px;}
thead tr{background:#0F172A;color:#fff;}
thead th{padding:8px 6px;text-align:left;font-size:8.5px;letter-spacing:.06em;text-transform:uppercase;font-weight:700;}
thead th.num{text-align:right;}
tbody tr:nth-child(even){background:#F8FAFC;}
tbody td{padding:6px;border-bottom:1px solid #E2E8F0;vertical-align:middle;}
tbody td.num{text-align:right;font-variant-numeric:tabular-nums;}
tbody td.strong{font-weight:700;color:#0F172A;}
tbody td.ded{font-weight:700;color:#15803D;}
tfoot tr{background:#F1F5F9;}
tfoot td{padding:9px 6px;font-weight:800;font-size:10px;border-top:2px solid #0F172A;}
tfoot td.num{text-align:right;font-variant-numeric:tabular-nums;}
tfoot td.ded{color:#15803D;}

/* Notes & footer */
.notes{background:#FFFBEB;border:1px solid #FCD34D;border-radius:8px;padding:13px 15px;margin-bottom:14px;font-size:10px;color:#78350F;line-height:1.7;}
.notes strong{display:block;font-size:11px;margin-bottom:5px;color:#78350F;}
.footer{text-align:center;color:#94A3B8;font-size:9px;border-top:1px solid #E2E8F0;padding-top:10px;margin-top:6px;}

/* Print */
@media print{
  body{padding:14px;}
  @page{margin:1cm;size:A4 landscape;}
  .hero-grid,.mini-grid{page-break-inside:avoid;}
  table{page-break-inside:auto;}
  tr{page-break-inside:avoid;}
  thead{display:table-header-group;}
}
</style></head><body>

<div class="header">
  <div class="brand-block">
    <div class="brand-logo">GT</div>
    <div>
      <div class="brand-name">GigTrack</div>
      <div class="brand-tag">ATO Shift Report</div>
    </div>
  </div>
  <div class="header-right">
    <strong>${user?.name || "Driver"}</strong>
    Generated ${fmtD(new Date().toISOString())}<br>
    ${sorted.length} shift${sorted.length !== 1 ? "s" : ""} included
  </div>
</div>

<div class="period">${periodLabel}</div>

<!-- HERO SQUARES -->
<div class="hero-grid">
  <div class="hero h-green">
    <div class="hero-label">Total earned</div>
    <div class="hero-value">${fmtMoney(totalEarned)}</div>
    <div class="hero-sub">${sorted.length} shift${sorted.length !== 1 ? "s" : ""}</div>
  </div>
  <div class="hero h-blue">
    <div class="hero-label">ATO Deduction</div>
    <div class="hero-value">${fmtMoney(totalDed)}</div>
    <div class="hero-sub">${cappedKm.toFixed(1)} km × $${ATO_RATE_PER_KM.toFixed(2)}/km${totalTotalKm > ATO_KM_CAP ? ` (capped at ${ATO_KM_CAP.toLocaleString()})` : ""}</div>
  </div>
  <div class="hero h-amber">
    <div class="hero-label">Distance</div>
    <div class="hero-value">${totalTotalKm.toFixed(1)} km</div>
    <div class="hero-sub">${totalActiveKm.toFixed(1)} km on active delivery</div>
  </div>
  <div class="hero h-purple">
    <div class="hero-label">Est. tax saved</div>
    <div class="hero-value">${fmtMoney(estTaxSaved)}</div>
    <div class="hero-sub">at 32.5% marginal rate</div>
  </div>
</div>

<!-- MINI BREAKDOWN -->
<div class="mini-grid">
  <div class="mini"><div class="mini-label">Base earnings</div><div class="mini-value">${fmtMoney(totalBase)}</div></div>
  <div class="mini"><div class="mini-label">Tips</div><div class="mini-value">${fmtMoney(totalTips)}</div></div>
  <div class="mini"><div class="mini-label">Bonuses</div><div class="mini-value">${fmtMoney(totalBonuses)}</div></div>
  <div class="mini"><div class="mini-label">Deliveries · Online hrs</div><div class="mini-value">${totalDels} · ${totalHrs.toFixed(1)} hrs</div></div>
</div>

<!-- TABLE -->
<div class="section-title">Chronological shift breakdown</div>
<table>
  <thead>
    <tr>
      <th class="num">#</th>
      <th>Date</th>
      <th>Start</th>
      <th>Platform</th>
      <th class="num">Duration</th>
      <th class="num">Total km</th>
      <th class="num">Dels</th>
      <th class="num">Base</th>
      <th class="num">Tips</th>
      <th class="num">Bonus</th>
      <th class="num">Earned</th>
      <th class="num">ATO ded.</th>
    </tr>
  </thead>
  <tbody>${rows}</tbody>
  <tfoot>
    <tr>
      <td colspan="4">TOTAL (${sorted.length} shifts)</td>
      <td class="num">${totalHrs.toFixed(1)}h</td>
      <td class="num">${totalTotalKm.toFixed(1)}</td>
      <td class="num">${totalDels}</td>
      <td class="num">${fmtMoney(totalBase)}</td>
      <td class="num">${fmtMoney(totalTips)}</td>
      <td class="num">${fmtMoney(totalBonuses)}</td>
      <td class="num">${fmtMoney(totalEarned)}</td>
      <td class="num ded">${fmtMoney(totalDed)}</td>
    </tr>
  </tfoot>
</table>

<div class="notes">
  <strong>ATO disclaimer & method</strong>
  This report uses the ATO cents per kilometre method for ${ATO_FY_LABEL}: $${ATO_RATE_PER_KM.toFixed(2)}/km, capped at ${ATO_KM_CAP.toLocaleString()}km per financial year. Estimated tax saving applies a 32.5% marginal rate as a guide only — your actual rate depends on your total taxable income. GigTrack does not provide tax advice. Confirm all figures with a registered tax agent or visit ato.gov.au before lodging your return.
</div>

<div class="footer">
  GigTrack · Generated ${new Date().toLocaleDateString("en-AU", { day:"2-digit", month:"long", year:"numeric" })} ${new Date().toLocaleTimeString("en-AU", { hour:"2-digit", minute:"2-digit" })}
</div>

</body></html>`;

  const win = window.open("", "_blank");
  if (!win) { alert("Allow popups for GigTrack to export PDF."); return; }
  win.document.write(html);
  win.document.close();
  win.onload = () => { win.focus(); setTimeout(() => win.print(), 250); };
}

// ─── TRIP LOG ───
function TripLogScreen({ trips, onBack, onDetail, kmPref, user, fuelEfficiency, fuelPrice, isPro = false, onUpgrade }) {
  const [sort, setSort] = useState("date");
  const sorted = [...trips].sort((a, b) => {
    if (sort === "date") return new Date(b.ts) - new Date(a.ts);
    if (sort === "score") return b.score - a.score;
    if (sort === "earned") return b.totalEarned - a.totalEarned;
    return 0;
  });

  // Group by Month-Year (only when sorted by date)
  const grouped = sort === "date"
    ? sorted.reduce((acc, t) => {
        const d = new Date(t.ts);
        const key = d.toLocaleDateString("en-AU", { month: "long", year: "numeric" });
        if (!acc[key]) acc[key] = [];
        acc[key].push(t);
        return acc;
      }, {})
    : { "Sorted": sorted };

  return (
    <div className="view active">
      <div className="topbar">
        <button className="topbar-back" onClick={onBack}>←</button>
        <div className="topbar-title">Shift Log</div>
        {trips.length > 0 && (
          isPro ? (
            <button className="export-btn" style={{marginLeft:"auto"}} onClick={() => exportPDF(trips, user)}>
              🧾 Export
            </button>
          ) : (
            <button className="export-btn" style={{marginLeft:"auto",opacity:0.6}} onClick={onUpgrade}>
              🔒 Export
            </button>
          )
        )}
      </div>
      <div className="scroll-area">
        {/* Sort chips — pill style */}
        <div style={{display:"flex",gap:"6px",padding:"12px 16px 0"}}>
          {[["date","Newest"],["score","Score ↓"],["earned","Earned ↓"]].map(([s,l]) => (
            <div
              key={s}
              onClick={() => setSort(s)}
              style={{
                padding:"7px 14px",borderRadius:"100px",
                fontSize:"12px",fontWeight:"600",cursor:"pointer",
                background: sort===s ? "var(--text)" : "var(--surface)",
                color: sort===s ? "#fff" : "var(--text)",
                border: `0.5px solid ${sort===s ? "var(--text)" : "var(--border)"}`,
                boxShadow: sort===s ? "none" : "var(--shadow-card)",
                transition:"all var(--tr)",
              }}
            >{l}</div>
          ))}
        </div>

        {!trips.length ? (
          <div className="empty-state" style={{margin:"40px 14px 0"}}>
            <div className="empty-icon">📋</div>
            <div className="empty-title">No shifts yet</div>
            <div className="empty-sub">Log your first shift to see it here.</div>
          </div>
        ) : Object.entries(grouped).map(([groupName, shifts]) => (
          <div key={groupName}>
            {sort === "date" && (
              <div style={{
                padding:"18px 22px 8px",
                fontSize:"11px",fontWeight:"700",
                color:"var(--muted2)",
                letterSpacing:".08em",textTransform:"uppercase",
              }}>
                {groupName}
              </div>
            )}
            <div style={{display:"flex",flexDirection:"column",gap:"6px",padding:"0 16px"}}>
              {shifts.map(t => {
                const d = new Date(t.ts);
                const color = scoreColor(t.score);
                const hh = Math.floor(t.totalHrs);
                const mm = Math.round((t.totalHrs - hh) * 60);
                const timeStr = hh > 0 ? `${hh}h ${String(mm).padStart(2,"0")}m` : `${mm}m`;
                return (
                  <div
                    key={t.id}
                    onClick={() => onDetail(t.id)}
                    style={{
                      background:"var(--surface)",borderRadius:"14px",
                      padding:"14px",
                      boxShadow:"var(--shadow-card)",
                      cursor:"pointer",
                      transition:"transform var(--tr)",
                    }}
                  >
                    {/* Top row — date + earnings hero */}
                    <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:"10px"}}>
                      <div style={{fontSize:"12px",fontWeight:"700",color:"var(--text)"}}>
                        {d.toLocaleDateString("en-AU",{weekday:"short",month:"short",day:"numeric"})} · {d.toLocaleTimeString("en-AU",{hour:"numeric",minute:"2-digit"})}
                      </div>
                      <div style={{textAlign:"right"}}>
                        <div style={{
                          fontFamily:"'Geist Mono',monospace",
                          fontSize:"19px",fontWeight:"800",color:"var(--text)",
                          letterSpacing:"-.02em",fontVariantNumeric:"tabular-nums",
                          lineHeight:1,
                        }}>{fmt$(t.totalEarned)}</div>
                        <div style={{fontSize:"8px",fontWeight:"700",color:"var(--muted2)",letterSpacing:".08em",textAlign:"right",marginTop:"3px"}}>EARNED</div>
                      </div>
                    </div>
                    {/* Stat row — TIME / KMs / SCORE with dividers */}
                    <div style={{display:"flex"}}>
                      {[
                        ["TIME",  timeStr, "var(--text)"],
                        ["KMs",   t.totalKm.toFixed(1), "var(--text)"],
                        ["SCORE", t.score.toFixed(1)+"%", color],
                      ].map(([label, value, col], i) => (
                        <div key={label} style={{
                          flex:1,
                          paddingLeft: i === 0 ? "0" : "10px",
                          paddingRight: i < 2 ? "10px" : "0",
                          borderRight: i < 2 ? "0.5px solid var(--border)" : "none",
                        }}>
                          <div style={{fontSize:"13px",fontWeight:"700",color:col,fontVariantNumeric:"tabular-nums",fontFamily:"'Geist Mono',monospace"}}>{value}</div>
                          <div style={{fontSize:"9px",color:"var(--muted2)",marginTop:"2px",fontWeight:"500"}}>{label}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
        <div style={{height:"80px"}} />
      </div>
    </div>
  );
}

// ─── INSIGHTS SCREEN ──────────────────────────────────────────────────────
function InsightsScreen({ trips, kmPref, fuelEfficiency, fuelPrice }) {
  const [period, setPeriod] = useState("week");
  const [showPicker, setShowPicker] = useState(false);

  const periods = [
    { id: "7days", label: "Last 7 Days" },
    { id: "week",  label: "This Week" },
    { id: "month", label: "This Month" },
    { id: "fy",    label: "This FY" },
    { id: "year",  label: "This Year" },
  ];

  // Get trips for chosen period
  const now = new Date();
  const getFiltered = () => {
    if (period === "7days") {
      const start = new Date(); start.setDate(start.getDate() - 6); start.setHours(0,0,0,0);
      return trips.filter(t => new Date(t.ts) >= start);
    }
    if (period === "week") {
      const { weekStart, weekEnd } = getWeekBounds();
      return trips.filter(t => { const d = new Date(t.ts); return d >= weekStart && d < weekEnd; });
    }
    if (period === "month") {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      return trips.filter(t => new Date(t.ts) >= start);
    }
    if (period === "fy") {
      const { fyStart } = getFYBounds();
      return trips.filter(t => new Date(t.ts) >= fyStart);
    }
    if (period === "year") {
      const start = new Date(now.getFullYear(), 0, 1);
      return trips.filter(t => new Date(t.ts) >= start);
    }
    return trips;
  };

  const filtered = getFiltered();

  // Previous period for comparison
  const getPrev = () => {
    if (period === "7days") {
      const ps = new Date(); ps.setDate(ps.getDate() - 13); ps.setHours(0,0,0,0);
      const pe = new Date(); pe.setDate(pe.getDate() - 6);  pe.setHours(0,0,0,0);
      return trips.filter(t => { const d = new Date(t.ts); return d >= ps && d < pe; });
    }
    if (period === "week") {
      const { weekStart, weekEnd } = getWeekBounds();
      const ps = new Date(weekStart); ps.setDate(ps.getDate() - 7);
      const pe = new Date(weekEnd);   pe.setDate(pe.getDate() - 7);
      return trips.filter(t => { const d = new Date(t.ts); return d >= ps && d < pe; });
    }
    if (period === "month") {
      const ps = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const pe = new Date(now.getFullYear(), now.getMonth(), 1);
      return trips.filter(t => { const d = new Date(t.ts); return d >= ps && d < pe; });
    }
    if (period === "year") {
      const ps = new Date(now.getFullYear() - 1, 0, 1);
      const pe = new Date(now.getFullYear(), 0, 1);
      return trips.filter(t => { const d = new Date(t.ts); return d >= ps && d < pe; });
    }
    return [];
  };

  const prevTrips   = getPrev();
  const earned      = parseFloat(filtered.reduce((s,t) => s+t.totalEarned, 0).toFixed(2));
  const prevEarned  = parseFloat(prevTrips.reduce((s,t) => s+t.totalEarned, 0).toFixed(2));
  const diff        = earned - prevEarned;
  const pctChange   = prevEarned > 0 ? (diff / prevEarned) * 100 : null;

  // Stats
  const totalMins  = filtered.reduce((s,t) => s+(t.activeMin||Math.round((t.activeHrs||t.totalHrs||0)*60)), 0);
  const totalHours = Math.floor(totalMins / 60);
  const remMins    = totalMins % 60;
  const totalDels  = filtered.reduce((s,t) => s+(t.dels||0), 0);
  const days       = filtered.length > 0 ? (() => {
    const dates = new Set(filtered.map(t => new Date(t.ts).toDateString()));
    return dates.size;
  })() : 0;
  const avgPerDay  = days > 0 ? earned / days : 0;

  // Bar chart data — last 7 days for week, last 4 weeks for month, last 12 months for FY/year
  const getChartData = () => {
    if (period === "7days") {
      const dayLetters = ["S","M","T","W","T","F","S"];
      return Array.from({length: 7}, (_, i) => {
        const day = new Date(); day.setDate(day.getDate() - 6 + i); day.setHours(0,0,0,0);
        const dayEnd = new Date(day); dayEnd.setDate(dayEnd.getDate() + 1);
        const val = trips
          .filter(t => { const d = new Date(t.ts); return d >= day && d < dayEnd; })
          .reduce((s, t) => s + t.totalEarned, 0);
        return { label: dayLetters[day.getDay()], val, isToday: i === 6 };
      });
    }
    if (period === "week") {
      const { weekStart } = getWeekBounds();
      const days = ["M","T","W","T","F","S","S"];
      return days.map((label, i) => {
        const day = new Date(weekStart); day.setDate(day.getDate() + i);
        const dayEnd = new Date(day); dayEnd.setDate(dayEnd.getDate() + 1);
        const val = trips
          .filter(t => { const d = new Date(t.ts); return d >= day && d < dayEnd; })
          .reduce((s,t) => s+t.totalEarned, 0);
        return { label, val };
      });
    }
    if (period === "month") {
      // Last 4 weeks
      return Array.from({length: 4}, (_, i) => {
        const ws = new Date(now); ws.setDate(ws.getDate() - (3-i)*7 - now.getDay() + 1);
        ws.setHours(0,0,0,0);
        const we = new Date(ws); we.setDate(we.getDate() + 7);
        const val = trips.filter(t => { const d = new Date(t.ts); return d >= ws && d < we; }).reduce((s,t)=>s+t.totalEarned,0);
        return { label: `W${i+1}`, val };
      });
    }
    // FY / Year — last 12 months
    return Array.from({length: 12}, (_, i) => {
      const ms = new Date(now.getFullYear(), now.getMonth() - 11 + i, 1);
      const me = new Date(now.getFullYear(), now.getMonth() - 10 + i, 1);
      const val = trips.filter(t => { const d = new Date(t.ts); return d >= ms && d < me; }).reduce((s,t)=>s+t.totalEarned,0);
      const label = ms.toLocaleDateString("en-AU",{month:"short"}).slice(0,1);
      return { label, val };
    });
  };

  const chartData = getChartData();
  const maxVal = Math.max(...chartData.map(d => d.val), 1);

  // All-time stats (Personal Records)
  const allEarned  = trips.reduce((s,t) => s+t.totalEarned, 0);
  const allDels    = trips.reduce((s,t) => s+(t.dels||0), 0);
  const allTips    = trips.reduce((s,t) => s+(t.tip||0), 0);
  const allBonuses = trips.reduce((s,t) => s+(t.bonus||0), 0);
  const allKm      = trips.reduce((s,t) => s+(t.totalKm||0), 0);
  const allHrs     = trips.reduce((s,t) => s+(t.totalHrs||0), 0);
  const allActiveMins = (() => {
    const m = trips.reduce((s,t) => s+(t.activeMin||Math.round((t.activeHrs||t.totalHrs||0)*60)), 0);
    return `${Math.floor(m/60)}h ${m%60}m`;
  })();
  const bestShift  = trips.length ? trips.reduce((best,t) => t.totalEarned > best.totalEarned ? t : best, trips[0]) : null;
  const bestScore  = trips.length ? Math.max(...trips.map(t=>t.score)) : null;
  const avgHourly  = allHrs > 0 ? allEarned / allHrs : 0;
  const avgPerDel  = allDels > 0 ? allEarned / allDels : 0;
  const avgPerShift= trips.length ? allEarned / trips.length : 0;
  const allDeduction = (kmPref === "active"
    ? trips.reduce((s,t) => s+(t.kmDel||0), 0)
    : allKm) * ATO_RATE_PER_KM;

  const currentLabel = periods.find(p => p.id === period)?.label;

  return (
    <div className="view active">
      <div className="topbar">
        <div style={{width:"34px"}} />
        <div className="topbar-title">Insights</div>
        <div style={{width:"34px"}} />
      </div>
      <div className="scroll-area">
        <div style={{padding:"12px 16px 80px"}}>

          {/* Earnings hero card with chart */}
          <div style={{
            background:"var(--surface)",borderRadius:"16px",padding:"18px",
            marginBottom:"10px",boxShadow:"var(--shadow-card)",
          }}>
            {/* Header — label + period pill */}
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"10px"}}>
              <div style={{fontSize:"11px",color:"var(--muted2)",fontWeight:"600",letterSpacing:".04em",textTransform:"uppercase"}}>
                Total Earned
              </div>
              {/* Period picker — pill chip */}
              <div style={{position:"relative"}}>
                <div
                  onClick={() => setShowPicker(v => !v)}
                  style={{
                    display:"flex",alignItems:"center",gap:"4px",cursor:"pointer",
                    fontSize:"11px",fontWeight:"600",color:"var(--text)",
                    background:"var(--elevated)",
                    padding:"5px 10px",borderRadius:"100px",
                  }}
                >
                  {currentLabel}
                  <span style={{fontSize:"9px",color:"var(--muted)",marginLeft:"2px"}}>▾</span>
                </div>
                {showPicker && (
                  <div style={{
                    position:"absolute",right:0,top:"30px",
                    background:"var(--surface)",border:"0.5px solid var(--border)",
                    borderRadius:"12px",overflow:"hidden",zIndex:50,minWidth:"140px",
                    boxShadow:"0 8px 24px rgba(0,0,0,.12)",
                  }}>
                    {periods.map(p => (
                      <div
                        key={p.id}
                        onClick={() => { setPeriod(p.id); setShowPicker(false); }}
                        style={{
                          padding:"11px 16px",fontSize:"13px",fontWeight:"500",cursor:"pointer",
                          color: p.id === period ? "var(--green)" : "var(--text)",
                          background: p.id === period ? "var(--green-dim)" : "transparent",
                        }}
                      >{p.label}</div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Big number */}
            <div style={{
              fontSize:"38px",fontWeight:"800",color:"var(--text)",
              letterSpacing:"-.03em",lineHeight:1,fontVariantNumeric:"tabular-nums",
              marginBottom:"6px",
            }}>
              ${Math.floor(earned)}<span style={{fontSize:"20px",fontWeight:"500",color:"var(--muted2)"}}>
                .{String(Math.round((earned - Math.floor(earned)) * 100)).padStart(2,"0")}
              </span>
            </div>

            {/* Comparison pill */}
            {pctChange !== null && (
              <div style={{
                display:"inline-flex",alignItems:"center",gap:"4px",
                fontSize:"12px",fontWeight:"700",
                color: diff >= 0 ? "var(--green)" : "var(--red)",
                background: diff >= 0 ? "var(--green-dim)" : "var(--red-dim)",
                padding:"4px 9px",borderRadius:"8px",
              }}>
                {diff >= 0 ? "▲" : "▼"} ${Math.abs(diff).toFixed(2)} vs {period === "7days" ? "prev 7 days" : period === "week" ? "last week" : period === "month" ? "last month" : "last year"}
              </div>
            )}

            {/* Bar chart */}
            {(() => {
              const CHART_H = 80;
              const LABEL_H = 20;
              return (
                <div style={{display:"flex",alignItems:"flex-end",gap:"2px",height:`${CHART_H + LABEL_H}px`,paddingTop:"14px"}}>
                  {chartData.map((bar, i) => {
                    const isToday = bar.isToday ?? (period === "week" && i === (new Date().getDay() + 6) % 7);
                    const barH = maxVal > 0 && bar.val > 0
                      ? Math.max(6, Math.round((bar.val / maxVal) * CHART_H))
                      : 3;
                    return (
                      <div key={i} style={{
                        flex: 1,
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        justifyContent: "flex-end",
                        height: "100%",
                        gap: "4px",
                      }}>
                        <div style={{flex:1}} />
                        <div style={{
                          width: "60%",
                          height: `${barH}px`,
                          background: bar.val > 0
                            ? (isToday ? "var(--green)" : "rgba(0,143,68,.4)")
                            : "var(--elevated)",
                          borderRadius: "3px 3px 0 0",
                          transition: "height .4s ease",
                          flexShrink: 0,
                        }} />
                        <div style={{
                          fontSize: "9px",
                          color: isToday ? "var(--green)" : "var(--muted2)",
                          fontWeight: isToday ? "700" : "600",
                          height: `${LABEL_H}px`,
                          display: "flex",
                          alignItems: "center",
                          flexShrink: 0,
                        }}>
                          {bar.label}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </div>

          {/* Dynamic stats row */}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:"6px",marginBottom:"10px"}}>
            {[
              ["Avg/Day",         avgPerDay > 0   ? `$${avgPerDay.toFixed(2)}`        : "—"],
              ["Total Time",      totalMins > 0   ? `${totalHours}h ${remMins}m`      : "—"],
              ["Total Deliveries",totalDels > 0   ? String(totalDels)                 : "—"],
            ].map(([label, value]) => (
              <div key={label} style={{
                background:"var(--surface)",borderRadius:"12px",padding:"12px 9px",
                textAlign:"center",boxShadow:"var(--shadow-card)",
              }}>
                <div style={{
                  fontSize:"15px",fontWeight:"800",color:"var(--text)",
                  fontVariantNumeric:"tabular-nums",fontFamily:"'Geist Mono',monospace",
                  letterSpacing:"-.01em",lineHeight:1,
                }}>{value}</div>
                <div style={{fontSize:"9px",color:"var(--muted2)",marginTop:"4px",fontWeight:"500"}}>{label}</div>
              </div>
            ))}
          </div>

          {/* All Time Stats */}
          <div style={{
            background:"var(--surface)",borderRadius:"16px",padding:"18px",
            boxShadow:"var(--shadow-card)",
          }}>
            <div style={{
              fontSize:"11px",color:"var(--muted2)",fontWeight:"700",
              letterSpacing:".08em",textTransform:"uppercase",marginBottom:"14px",
            }}>All Time Stats</div>

            {trips.length === 0 ? (
              <div style={{textAlign:"center",color:"var(--muted2)",fontSize:"12px",padding:"20px 0"}}>No shifts logged yet.</div>
            ) : (
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"8px"}}>

                {/* HERO — Total earned + averages */}
                <div style={{
                  gridColumn:"1 / -1",
                  background:"linear-gradient(180deg, var(--elevated) 0%, var(--surface) 100%)",
                  borderRadius:"14px",
                  border:"0.5px solid var(--green-border)",
                  padding:"18px 16px 16px 18px",
                  position:"relative",
                  overflow:"hidden",
                }}>
                  <div style={{position:"absolute",left:0,top:0,bottom:0,width:"4px",background:"var(--green)"}} />
                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"10px"}}>
                    <div style={{
                      width:"32px",height:"32px",borderRadius:"9px",
                      background:"var(--green-dim)",color:"var(--green)",
                      display:"flex",alignItems:"center",justifyContent:"center",
                    }}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="12" y1="2" x2="12" y2="22"/>
                        <path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/>
                      </svg>
                    </div>
                  </div>
                  <div style={{
                    fontFamily:"'Inter',sans-serif",fontSize:"34px",fontWeight:"800",
                    color:"var(--green)",letterSpacing:"-.03em",lineHeight:"1",
                    fontVariantNumeric:"tabular-nums",
                  }}>${allEarned.toFixed(2)}</div>
                  <div style={{
                    fontFamily:"'Inter',sans-serif",fontSize:"12px",color:"var(--muted)",
                    marginTop:"8px",fontWeight:"500",
                  }}>Total earned · {trips.length} shift{trips.length !== 1 ? "s" : ""}</div>

                  <div style={{
                    display:"flex",gap:"14px",marginTop:"14px",paddingTop:"12px",
                    borderTop:"0.5px solid var(--border)",
                  }}>
                    {[
                      [avgHourly > 0 ? `$${avgHourly.toFixed(2)}` : "—", "avg/hr"],
                      [avgPerDel  > 0 ? `$${avgPerDel.toFixed(2)}`  : "—", "avg/del"],
                      [avgPerShift> 0 ? `$${avgPerShift.toFixed(2)}`: "—", "avg/shift"],
                    ].map(([v,l]) => (
                      <div key={l} style={{flex:1}}>
                        <div style={{
                          fontFamily:"'Inter',sans-serif",fontSize:"14px",fontWeight:"700",
                          color:"var(--text)",letterSpacing:"-.01em",
                          fontVariantNumeric:"tabular-nums",
                        }}>{v}</div>
                        <div style={{
                          fontFamily:"'Inter',sans-serif",fontSize:"10px",color:"var(--muted2)",
                          marginTop:"3px",fontWeight:"500",
                        }}>{l}</div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Colored category tiles */}
                {(() => {
                  // Inline SVG icon factory — matches app's stroke icon style
                  const Ico = ({ d, fill }) => (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill={fill?"currentColor":"none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      {d}
                    </svg>
                  );
                  const ICO = {
                    tip:      <Ico d={<><circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 015 0c0 1.5-2.5 2-2.5 3.5M12 17h.01"/></>} />,
                    bonus:    <Ico d={<><rect x="3" y="8" width="18" height="13" rx="1.5"/><path d="M12 8v13M3 12h18M7.5 8c0-2 1.5-3.5 3.5-3.5S14.5 6 14.5 8M16.5 8c0-2-1.5-3.5-3.5-3.5"/></>} />,
                    package:  <Ico d={<><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><path d="M3.27 6.96L12 12.01l8.73-5.05M12 22.08V12"/></>} />,
                    clock:    <Ico d={<><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>} />,
                    route:    <Ico d={<><circle cx="6" cy="19" r="2.5"/><circle cx="18" cy="5" r="2.5"/><path d="M8.5 19H15a3.5 3.5 0 000-7H9a3.5 3.5 0 010-7h6.5"/></>} />,
                    receipt:  <Ico d={<><path d="M4 2v20l3-2 3 2 2-2 2 2 3-2 3 2V2H4z"/><path d="M8 7h8M8 11h8M8 15h5"/></>} />,
                    trophy:   <Ico d={<><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 01-10 0V4zM7 4H4v3a3 3 0 003 3M17 4h3v3a3 3 0 01-3 3"/></>} />,
                    star:     <Ico d={<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>} />,
                  };

                  return [
                    ["Total tips",     `$${allTips.toFixed(2)}`,    "green",  ICO.tip],
                    ["Total bonuses",  `$${allBonuses.toFixed(2)}`, "green",  ICO.bonus],
                    ["Deliveries",     String(allDels),             "amber",  ICO.package],
                    ["Active time",    allActiveMins,               "amber",  ICO.clock],
                    ["Distance",       `${allKm.toFixed(1)} km`,    "blue",   ICO.route],
                    ["Tax deduction",  `$${allDeduction.toFixed(2)}`,"blue",  ICO.receipt],
                    ["Best shift",     bestShift ? `$${bestShift.totalEarned.toFixed(2)}` : "—", "purple", ICO.trophy],
                    ["Best score",     bestScore != null ? `${bestScore.toFixed(1)}%` : "—",     "purple", ICO.star],
                  ].map(([label, value, color, iconNode]) => (
                    <div key={label} style={{
                      background:"var(--elevated)",
                      borderRadius:"14px",
                      border:"0.5px solid var(--border)",
                      padding:"12px 12px 12px 14px",
                      position:"relative",
                      overflow:"hidden",
                      display:"flex",
                      flexDirection:"column",
                      gap:"8px",
                    }}>
                      <div style={{
                        position:"absolute",left:0,top:0,bottom:0,width:"3px",
                        background:`var(--${color})`,
                      }} />
                      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                        <div style={{
                          width:"24px",height:"24px",borderRadius:"7px",
                          background:`var(--${color}-dim)`,
                          color:`var(--${color})`,
                          display:"flex",alignItems:"center",justifyContent:"center",
                        }}>{iconNode}</div>
                      </div>
                      <div>
                        <div style={{
                          fontFamily:"'Inter',sans-serif",fontSize:"18px",fontWeight:"700",
                          color:"var(--text)",letterSpacing:"-.02em",lineHeight:"1",
                          fontVariantNumeric:"tabular-nums",
                        }}>{value}</div>
                        <div style={{
                          fontFamily:"'Inter',sans-serif",fontSize:"11px",color:"var(--muted)",
                          marginTop:"6px",fontWeight:"500",
                        }}>{label}</div>
                      </div>
                    </div>
                  ));
                })()}

              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}

// ─── DETAIL SCREEN ───
function DetailScreen({ trip, onBack, onEdit, onDelete, kmPref, targets = DEFAULT_TARGETS, fuelEfficiency, fuelPrice, onGoToSettings, trips = [] }) {
  if (!trip) return null;
  const d = new Date(trip.ts);
  const sc = scoreClass(trip.score);
  const activeKmPct = trip.totalKm > 0 ? (trip.kmDel / trip.totalKm) * 100 : 0;
  const deductKm = kmPref === "active" ? trip.kmDel : trip.totalKm;
  const deduction = deductKm * ATO_RATE_PER_KM;

  // Compute lifetime averages from all other trips (excluding this one for fairness)
  const otherTrips = trips.filter(t => t.id !== trip.id);
  const hasAvg = otherTrips.length > 0;
  const avgEarned  = hasAvg ? otherTrips.reduce((s,t) => s + t.totalEarned, 0) / otherTrips.length : null;
  const avgHourly  = hasAvg && otherTrips.filter(t=>t.totalHrs>0).length > 0
    ? otherTrips.filter(t=>t.totalHrs>0).reduce((s,t)=>s+t.hourly,0) / otherTrips.filter(t=>t.totalHrs>0).length : null;
  const avgPerDel  = hasAvg && otherTrips.filter(t=>t.dels>0).length > 0
    ? otherTrips.filter(t=>t.dels>0).reduce((s,t)=>s+t.perDel,0) / otherTrips.filter(t=>t.dels>0).length : null;
  const avgKm      = hasAvg ? otherTrips.reduce((s,t) => s + t.totalKm, 0) / otherTrips.length : null;
  const avgScore   = hasAvg ? otherTrips.reduce((s,t) => s + t.score, 0) / otherTrips.length : null;

  const DI = ({ label, value, wide, green, teal }) => (
    <div className={`detail-item${wide?" wide":""}`}>
      <div className="detail-item-label">{label}</div>
      <div className="detail-item-value" style={green?{color:"var(--green)"}:teal?{color:"var(--blue)"}:{}}>{value}</div>
    </div>
  );

  // Comparison item — shows value + vs-avg delta
  const DIC = ({ label, value, actual, avg, wide, fmt, higherIsBetter = true }) => {
    const showDelta = avg !== null && actual !== null && !isNaN(actual) && !isNaN(avg);
    const delta = actual - avg;
    const isGood = higherIsBetter ? delta >= 0 : delta <= 0;
    const arrow = delta >= 0 ? "↑" : "↓";
    const color = showDelta ? (isGood ? "var(--green)" : "var(--red)") : "var(--muted2)";
    const deltaStr = fmt ? fmt(Math.abs(delta)) : `${Math.abs(delta).toFixed(1)}`;
    return (
      <div className={`detail-item${wide?" wide":""}`}>
        <div className="detail-item-label">{label}</div>
        <div className="detail-item-value">{value}</div>
        {showDelta && (
          <div style={{fontSize:"10px",marginTop:"3px",color,fontFamily:"'Geist Mono',monospace"}}>
            {arrow} {deltaStr} vs avg
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="view active">
      <div className="topbar">
        <button className="topbar-back" onClick={onBack}>←</button>
        <div className="topbar-title">Shift Detail</div>
      </div>
      <div className="scroll-area" id="detail-scroll">
        <div className="detail-header">
          <div className="detail-date">{d.toLocaleDateString("en-CA",{weekday:"long",month:"long",day:"numeric",year:"numeric"})} · {d.toLocaleTimeString("en-CA",{hour:"2-digit",minute:"2-digit"})}</div>
          <div className="detail-app-name">Shift Summary</div>
        </div>

        <div className="detail-section">
          <div className="detail-section-title">Score</div>
          <div className={`score-block ${sc}`} style={{margin:0}}>
            <div>
              <div className="score-label">Shift Score</div>
              <div style={{fontSize:"10px",color:"var(--muted2)",marginTop:"2px"}}>
                {[trip.ratioH, trip.ratioD, trip.ratioK, trip.ratioA].filter(r => r !== null && r !== undefined).length} of 4 categories scored
              </div>
              {hasAvg && avgScore !== null && (
                <div style={{fontSize:"11px",marginTop:"4px",color: trip.score >= avgScore ? "var(--green)" : "var(--red)",fontFamily:"'Geist Mono',monospace"}}>
                  {trip.score >= avgScore ? "↑" : "↓"} {Math.abs(trip.score - avgScore).toFixed(1)}% vs avg ({avgScore.toFixed(1)}%)
                </div>
              )}
            </div>
            <div className="score-num">{trip.score.toFixed(1)}%</div>
          </div>
        </div>

        {/* ATO Deduction */}
        <div className="detail-section">
          <div className="detail-section-title">ATO Deduction ({ATO_FY_LABEL})</div>
          <div className="deduction-card" style={{margin:0}}>
            <div>
              <div className="ded-label">Est. Deduction — Cents Per KM</div>
              <div className="ded-value">{fmt$(deduction)}</div>
              <div className="ded-sub">{deductKm.toFixed(1)} km × ${ATO_RATE_PER_KM.toFixed(2)} · {kmPref==="active"?"delivery km only":"all shift km"}</div>
            </div>
            <div className="ded-icon">🧾</div>
          </div>
          <FuelCard
            totalKm={trip.totalKm}
            totalEarned={trip.totalEarned}
            fuelEfficiency={fuelEfficiency}
            fuelPrice={fuelPrice}
            onSetFuel={onGoToSettings}
          />
        </div>

        <div className="detail-section">
          <div className="detail-section-title">Earnings</div>
          <div className="detail-grid">
            <DI label="Total Earned" value={fmt$(trip.totalEarned)} green wide />
            <DI label="Base Pay" value={fmt$(trip.base)} />
            <DI label="Tips" value={fmt$(trip.tip)} />
            <DI label="Bonus" value={fmt$(trip.bonus)} />
          </div>
        </div>

        <div className="detail-section">
          <div className="detail-section-title">Time</div>
          <div className="detail-grid">
            <DI label="Shift Start" value={new Date(trip.ts).toLocaleTimeString("en-CA",{hour:"2-digit",minute:"2-digit"})} />
            <DI label="Shift End" value={(() => { const end = new Date(new Date(trip.ts).getTime() + trip.totalMin*60000); return end.toLocaleTimeString("en-CA",{hour:"2-digit",minute:"2-digit"}); })()} />
            <DI label="Online Time" value={`${trip.totalMin} min (${trip.totalHrs.toFixed(1)} hrs)`} />
            <DI label="Active Time" value={trip.activeMins ? `${trip.activeMins} min (${(trip.activeMins/60).toFixed(1)} hrs)` : "—"} />
            {trip.activeMins && trip.totalMin ? (
              <DI label="Active Time %" value={((trip.activeMins/trip.totalMin)*100).toFixed(0)+"%"} wide />
            ) : null}
          </div>
        </div>

        <div className="detail-section">
          <div className="detail-section-title">Distance</div>
          <div className="detail-grid">
            <DI label="Total KMs Driven" value={trip.totalKm.toFixed(1) + " km"} wide />
            {trip.activeKm != null && <DI label="Active KMs" value={trip.activeKm.toFixed(1) + " km"} />}
            {trip.activeKm != null && trip.totalKm > 0 && (
              <DI label="Active KM %" value={((trip.activeKm/trip.totalKm)*100).toFixed(0)+"%"} />
            )}
          </div>
        </div>

        <div className="detail-section">
          <div className="detail-section-title">Calculated Metrics {hasAvg && <span style={{fontSize:"9px",color:"var(--muted2)",fontWeight:400,marginLeft:"4px"}}>vs your average</span>}</div>
          <div className="detail-grid">
            <DIC label="Hourly Rate" value={trip.totalHrs>0?fmt$(trip.hourly)+"/hr":"—"} actual={trip.totalHrs>0?trip.hourly:null} avg={avgHourly} fmt={v=>"$"+v.toFixed(2)+"/hr"} />
            <DIC label="$ / Delivery" value={trip.dels>0?fmt$(trip.perDel):"—"} actual={trip.dels>0?trip.perDel:null} avg={avgPerDel} fmt={v=>"$"+v.toFixed(2)} />
            <DIC label="Total Earned" value={fmt$(trip.totalEarned)} actual={trip.totalEarned} avg={avgEarned} fmt={v=>"$"+v.toFixed(2)} wide />
            <DI label="Total KMs" value={trip.totalKm.toFixed(1)+" km"} />
            <DI label="$ / 100km" value={trip.totalKm>0?fmt$(trip.perKm):"—"} />
            <DI label="Active Time %" value={trip.activeMins ? fmtPct(trip.active) : "—"} />
            <DI label="Active KM %" value={(trip.activeKm != null && trip.totalKm>0) ? fmtPct((trip.activeKm/trip.totalKm)*100) : "—"} />
            <DI label="Deliveries" value={trip.dels} />
          </div>
        </div>

        <div className="detail-section">
          <div className="detail-section-title">Scoring Ratios</div>
          <div className="ratio-grid">
            <RatioBar ratio={trip.ratioH} label={`Hourly (tgt $${targets.hourly}/hr)`} />
            <RatioBar ratio={trip.ratioD} label={`Per Del (tgt $${targets.perDel})`} />
            {trip.ratioK != null
              ? <RatioBar ratio={trip.ratioK} label={`Active KM% (tgt ${targets.activeKm}%)`} />
              : <div className="ratio-card" style={{opacity:0.4}}>
                  <div className="ratio-card-label">Active KM% (tgt {targets.activeKm}%)</div>
                  <div className="ratio-bar-bg"><div className="ratio-bar" style={{width:"0%"}} /></div>
                  <div className="ratio-value" style={{color:"var(--muted2)",fontSize:"11px"}}>not entered</div>
                </div>
            }
            {trip.ratioA != null
              ? <RatioBar ratio={trip.ratioA} label={`Active Time% (tgt ${targets.activeTime}%)`} />
              : <div className="ratio-card" style={{opacity:0.4}}>
                  <div className="ratio-card-label">Active Time% (tgt {targets.activeTime}%)</div>
                  <div className="ratio-bar-bg"><div className="ratio-bar" style={{width:"0%"}} /></div>
                  <div className="ratio-value" style={{color:"var(--muted2)",fontSize:"11px"}}>not entered</div>
                </div>
            }
          </div>
        </div>

        {trip.expenses > 0 && (
          <div className="detail-section" style={{marginBottom:"8px"}}>
            <div className="detail-section-title">Expenses (not scored)</div>
            <div className="detail-grid">
              <DI label="Spent on Shift" value={fmt$(trip.expenses)} wide teal />
            </div>
          </div>
        )}
      </div>
      <div className="detail-action-bar">
        <div className="detail-action-row">
          <button className="btn btn-edit-style" style={{flex:1,padding:"15px"}} onClick={() => onEdit(trip.id)}>✏️ Edit</button>
          <button className="btn btn-danger" style={{flex:1,padding:"15px"}} onClick={() => onDelete(trip.id)}>🗑 Delete</button>
        </div>
      </div>
    </div>
  );
}

// ─── SETTINGS SCREEN ───
// Defined outside SettingsScreen so they don't remount on every keystroke
function SettingsSectionCard({ children, style }) {
  return (
    <div style={{
      background:"var(--surface)",
      borderRadius:"16px",overflow:"hidden",margin:"0 14px",
      boxShadow:"var(--shadow-card)",
      ...style,
    }}>
      {children}
    </div>
  );
}

function SettingsRow({ label, sub, right, onPress, chevron = true }) {
  return (
    <div
      className="settings-item"
      onClick={onPress}
      style={{cursor: onPress ? "pointer" : "default"}}
    >
      <div className="settings-item-left">
        <div className="settings-item-label">{label}</div>
        {sub && <div className="settings-item-sub">{sub}</div>}
      </div>
      <div style={{display:"flex",alignItems:"center",gap:"6px"}}>
        {right && <span style={{fontSize:"13px",color:"var(--muted)"}}>{right}</span>}
        {chevron && onPress && <span style={{fontSize:"14px",color:"var(--muted2)"}}>›</span>}
      </div>
    </div>
  );
}

function SettingsScreen({ user, trips = [], onBack, onUpdateUser, kmPref, onKmPref, atoRate, onAtoRate, targets, onTargets, weeklyGoal, onWeeklyGoal, fuelEfficiency, onFuelEfficiency, fuelPrice, onFuelPrice, region, onRegion, onDeleteAccount, isPro = false, onUpgrade, theme = "light", onTheme, authUser = null, onSignIn, onSignOut }) {
  // ── State ──────────────────────────────────────────────────────────────────
  const [name,      setName]      = useState(user?.name || "");
  const [regionVal, setRegionVal] = useState(region || "");
  const [defaultPlatform, setDefaultPlatform] = useState(DB.get("gt_default_platform") || "none");

  // Advanced
  const [rate,     setRate]     = useState(String(atoRate));
  const [odo,      setOdo]      = useState(String(user?.startOdo || ""));
  const [goalInput,setGoalInput]= useState(String(weeklyGoal || 800));
  const [fuelEff,  setFuelEff]  = useState(fuelEfficiency ? String(fuelEfficiency) : "");
  const [fuelPr,   setFuelPr]   = useState(fuelPrice ? String(fuelPrice) : "");
  const [tHourly,     setTHourly]    = useState(String(targets.hourly));
  const [tPerDel,     setTPerDel]    = useState(String(targets.perDel));
  const [tActiveKm,   setTActiveKm]  = useState(String(targets.activeKm));
  const [tActiveTime, setTActiveTime]= useState(String(targets.activeTime));
  const isCustom = targets.hourly !== DEFAULT_TARGETS.hourly ||
    targets.perDel !== DEFAULT_TARGETS.perDel ||
    targets.activeKm !== DEFAULT_TARGETS.activeKm ||
    targets.activeTime !== DEFAULT_TARGETS.activeTime;
  const resetTargets = () => {
    setTHourly(String(DEFAULT_TARGETS.hourly)); setTPerDel(String(DEFAULT_TARGETS.perDel));
    setTActiveKm(String(DEFAULT_TARGETS.activeKm)); setTActiveTime(String(DEFAULT_TARGETS.activeTime));
  };

  const [showAdvanced, setShowAdvanced] = useState(false);
  const [saved,   setSaved]   = useState(false);
  const [deleteStep, setDeleteStep] = useState(0);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");

  const regionsByState = REGIONS.reduce((acc, r) => {
    if (!acc[r.state]) acc[r.state] = {};
    const key = r.group || "_root";
    if (!acc[r.state][key]) acc[r.state][key] = [];
    acc[r.state][key].push(r); return acc;
  }, {});

  const currentRegion = REGIONS.find(r => r.id === regionVal);

  const save = () => {
    const r = parseFloat(rate);
    if (!isNaN(r) && r > 0) onAtoRate(r);
    onUpdateUser({ name: name.trim() || user.name, startOdo: parseFloat(odo) || user.startOdo, isPro: user.isPro, isGuest: user.isGuest });
    const newTargets = {
      hourly:     parseFloat(tHourly)     || DEFAULT_TARGETS.hourly,
      perDel:     parseFloat(tPerDel)     || DEFAULT_TARGETS.perDel,
      activeKm:   parseFloat(tActiveKm)   || DEFAULT_TARGETS.activeKm,
      activeTime: parseFloat(tActiveTime) || DEFAULT_TARGETS.activeTime,
    };
    onTargets(newTargets);
    const g = parseFloat(goalInput);
    if (!isNaN(g) && g > 0) onWeeklyGoal(g);
    const fe = parseFloat(fuelEff);
    if (!isNaN(fe) && fe > 0) onFuelEfficiency(fe);
    else if (fuelEff === "") onFuelEfficiency(null);
    const fp = parseFloat(fuelPr);
    if (!isNaN(fp) && fp > 0) onFuelPrice(fp);
    else if (fuelPr === "") onFuelPrice(null);
    onRegion(regionVal || null);
    DB.set("gt_default_platform", defaultPlatform);
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  // Shared row component
  return (
    <div className="view active">
      <div className="topbar">
        <button className="topbar-back" onClick={onBack}>←</button>
        <div className="topbar-title">Settings</div>
      </div>
      <div className="scroll-area">
        <div style={{display:"flex",flexDirection:"column",gap:"24px",padding:"16px 0 40px"}}>

          {/* ── Account card ── */}
          <div>
            <div style={{fontSize:"11px",fontWeight:"700",color:"var(--muted2)",letterSpacing:".1em",textTransform:"uppercase",padding:"0 18px 8px"}}>Account</div>
            <SettingsSectionCard>
              {/* Avatar + name row */}
              <div style={{display:"flex",alignItems:"center",gap:"14px",padding:"16px",borderBottom:"0.5px solid var(--border)"}}>
                <div style={{
                  width:"46px",height:"46px",borderRadius:"50%",
                  background:"linear-gradient(135deg, #00A050 0%, #008F44 100%)",
                  display:"flex",alignItems:"center",justifyContent:"center",
                  color:"#fff",fontSize:"19px",fontWeight:"700",flexShrink:0,
                  boxShadow:"0 2px 6px rgba(0,143,68,.25)",
                }}>
                  {(user?.name || "D")[0].toUpperCase()}
                </div>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:"15px",fontWeight:"700",color:"var(--text)",marginBottom:"2px",letterSpacing:"-.01em"}}>{user?.name || "Driver"}</div>
                  <div style={{fontSize:"11px",fontWeight:"600"}}>
                    {isPro
                      ? <span style={{color:"var(--green)"}}>🚀 GigTrack Pro</span>
                      : <span style={{color:"var(--muted)"}}>⚡ Free Plan</span>
                    }
                  </div>
                </div>
                {!isPro && (
                  <button
                    onClick={onUpgrade}
                    style={{
                      padding:"8px 14px",
                      background:"linear-gradient(180deg, #00A050 0%, #008F44 100%)",
                      color:"#fff",border:"none",borderRadius:"10px",
                      fontSize:"12px",fontWeight:"700",cursor:"pointer",flexShrink:0,
                      boxShadow:"0 4px 12px -2px rgba(0,143,68,.35)",
                    }}
                  >
                    Upgrade
                  </button>
                )}
              </div>

              {/* Display Name */}
              <div className="settings-item" style={{borderBottom:"0.5px solid var(--border)"}}>
                <div className="settings-item-left">
                  <div className="settings-item-label">Display Name</div>
                </div>
                <input
                  className="settings-input"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  style={{width:"140px",textAlign:"right"}}
                />
              </div>

              {/* Delivery Region */}
              <div style={{padding:"13px 15px"}}>
                <div style={{fontSize:"13px",fontWeight:"600",color:"var(--text)",marginBottom:"8px"}}>Delivery Region</div>
                <select
                  className="input-field"
                  value={regionVal}
                  onChange={e => setRegionVal(e.target.value)}
                  style={{colorScheme:"dark",width:"100%",fontSize:"13px"}}
                >
                  <option value="">— No region selected —</option>
                  {Object.entries(regionsByState).map(([state, groups]) => (
                    <React.Fragment key={state}>
                      {Object.entries(groups).map(([groupName, regions]) => (
                        <optgroup key={`${state}-${groupName}`} label={groupName === "_root" ? state : `${state} — ${groupName}`}>
                          {regions.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
                        </optgroup>
                      ))}
                    </React.Fragment>
                  ))}
                </select>
              </div>
            </SettingsSectionCard>
          </div>

          {/* ── Preferences ── */}
          <div>
            <div style={{fontSize:"12px",fontWeight:"700",color:"var(--muted2)",letterSpacing:".1em",textTransform:"uppercase",padding:"0 14px 8px"}}>Preferences</div>
            <SettingsSectionCard>
              {/* Default Platform */}
              <div style={{padding:"13px 15px",borderBottom:"0.5px solid var(--border)"}}>
                <div style={{fontSize:"13px",fontWeight:"600",color:"var(--text)",marginBottom:"10px"}}>Default Platform</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"6px"}}>
                  {[
                    {id:"uber_eats",label:"Uber Eats",color:"#06C167",bg:"rgba(6,193,103,.12)",border:"rgba(6,193,103,.35)"},
                    {id:"doordash", label:"DoorDash", color:"#FF3008",bg:"rgba(255,48,8,.12)", border:"rgba(255,48,8,.3)"},
                    {id:"both",     label:"Both",     color:"var(--muted)",bg:"var(--elevated)",border:"var(--border2)"},
                    {id:"none",     label:"None",     color:"var(--muted2)",bg:"var(--elevated)",border:"var(--border)"},
                  ].map(p => (
                    <div
                      key={p.id}
                      onClick={() => setDefaultPlatform(p.id)}
                      style={{
                        padding:"9px 12px",borderRadius:"8px",cursor:"pointer",
                        background: defaultPlatform===p.id ? p.bg : "var(--elevated)",
                        border:`1.5px solid ${defaultPlatform===p.id ? p.border : "var(--border)"}`,
                        display:"flex",alignItems:"center",gap:"8px",
                        transition:"all var(--tr)",
                      }}
                    >
                      <div style={{
                        width:"8px",height:"8px",borderRadius:"50%",flexShrink:0,
                        background: defaultPlatform===p.id ? p.color : "var(--border2)",
                      }}/>
                      <span style={{fontSize:"12px",fontWeight:"600",color: defaultPlatform===p.id ? p.color : "var(--muted)"}}>{p.label}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Distance Unit */}
              <div className="settings-item" style={{borderBottom:"0.5px solid var(--border)"}}>
                <div className="settings-item-left">
                  <div className="settings-item-label">Distance Unit</div>
                </div>
                <div style={{display:"flex",gap:"6px"}}>
                  {[["active","Active KMs"],["total","Total KMs"]].map(([v,l]) => (
                    <button
                      key={v}
                      onClick={() => onKmPref(v)}
                      style={{
                        padding:"5px 10px",borderRadius:"6px",fontSize:"11px",fontWeight:"600",cursor:"pointer",
                        background: kmPref===v ? "var(--green-dim)" : "var(--elevated)",
                        color: kmPref===v ? "var(--green)" : "var(--muted)",
                        border: `0.5px solid ${kmPref===v ? "var(--green-border)" : "var(--border)"}`,
                      }}
                    >{l}</button>
                  ))}
                </div>
              </div>

              {/* Currency */}
              <div className="settings-item" style={{borderBottom:"0.5px solid var(--border)"}}>
                <div className="settings-item-left">
                  <div className="settings-item-label">Currency</div>
                </div>
                <span style={{fontSize:"13px",color:"var(--muted)"}}>AUD ($)</span>
              </div>

              {/* Theme */}
              <div className="settings-item">
                <div className="settings-item-left">
                  <div className="settings-item-label">Theme</div>
                </div>
                <div style={{display:"flex",gap:"4px",background:"var(--elevated)",padding:"3px",borderRadius:"10px"}}>
                  {[
                    {id:"light", label:"Light"},
                    {id:"dark",  label:"Dark"},
                    {id:"system",label:"Auto"},
                  ].map(t => (
                    <button
                      key={t.id}
                      onClick={() => onTheme(t.id)}
                      style={{
                        padding:"5px 10px",
                        borderRadius:"7px",
                        fontSize:"11px",fontWeight:"600",
                        background: theme === t.id ? "var(--surface)" : "transparent",
                        color: theme === t.id ? "var(--text)" : "var(--muted)",
                        border:"none",cursor:"pointer",
                        boxShadow: theme === t.id ? "0 1px 2px rgba(0,0,0,.1)" : "none",
                        transition:"all var(--tr)",
                      }}
                    >{t.label}</button>
                  ))}
                </div>
              </div>
            </SettingsSectionCard>
          </div>

          {/* ── Data & Security ── */}
          <div>
            <div style={{fontSize:"12px",fontWeight:"700",color:"var(--muted2)",letterSpacing:".1em",textTransform:"uppercase",padding:"0 14px 8px"}}>Data &amp; Security</div>
            <SettingsSectionCard>
              {/* Account — always signed in, just shows email + sign-out */}
              {authUser && (
                <div
                  className="settings-item"
                  style={{borderBottom:"0.5px solid var(--border)",cursor:"pointer"}}
                  onClick={onSignOut}
                >
                  <div className="settings-item-left">
                    <div className="settings-item-label">Signed in</div>
                    <div className="settings-item-sub" style={{fontSize:"11px"}}>
                      {authUser.email || "—"} · tap to sign out
                    </div>
                  </div>
                  <span style={{fontSize:"14px",color:"var(--muted2)"}}>›</span>
                </div>
              )}

              {/* Export Data */}
              <div
                className="settings-item"
                style={{borderBottom:"0.5px solid var(--border)",cursor:"pointer"}}
                onClick={isPro ? () => exportPDF(trips, user) : onUpgrade}
              >
                <div className="settings-item-left">
                  <div className="settings-item-label">{!isPro && "🔒 "}Export Data</div>
                  <div className="settings-item-sub">Download your shift log as PDF</div>
                </div>
                <span style={{fontSize:"14px",color:"var(--muted2)"}}>›</span>
              </div>

              {/* Clear Local Data */}
              <div
                className="settings-item"
                style={{cursor:"pointer"}}
                onClick={() => setDeleteStep(1)}
              >
                <div className="settings-item-left">
                  <div className="settings-item-label" style={{color:"var(--red)"}}>Clear Local Data</div>
                  <div className="settings-item-sub">Erase all shifts and settings</div>
                </div>
                <span style={{fontSize:"14px",color:"var(--red)"}}>›</span>
              </div>
            </SettingsSectionCard>

            {/* Delete confirmation */}
            {deleteStep === 1 && (
              <div style={{margin:"8px 14px 0",background:"var(--red-dim)",border:"0.5px solid var(--red-border)",borderRadius:"12px",padding:"16px",display:"flex",flexDirection:"column",gap:"12px"}}>
                <div style={{fontSize:"14px",fontWeight:"700",color:"var(--red)"}}>Are you absolutely sure?</div>
                <div style={{fontSize:"12px",color:"var(--muted)",lineHeight:"1.7"}}>
                  This will permanently delete <strong style={{color:"var(--text)"}}>all your shifts, settings, and account data</strong>. This cannot be undone.
                </div>
                <div style={{display:"flex",gap:"8px"}}>
                  <button className="btn btn-outline" style={{flex:1,padding:"12px"}} onClick={() => setDeleteStep(0)}>Cancel</button>
                  <button className="btn btn-danger" style={{flex:2,padding:"12px"}} onClick={() => setDeleteStep(2)}>Yes, continue →</button>
                </div>
              </div>
            )}
            {deleteStep === 2 && (
              <div style={{margin:"8px 14px 0",background:"var(--red-dim)",border:"0.5px solid var(--red-border)",borderRadius:"12px",padding:"16px",display:"flex",flexDirection:"column",gap:"12px"}}>
                <div style={{fontSize:"14px",fontWeight:"700",color:"var(--red)"}}>Type DELETE to confirm</div>
                <input
                  className="input-field"
                  placeholder="Type DELETE to confirm"
                  value={deleteConfirmText}
                  onChange={e => setDeleteConfirmText(e.target.value)}
                  autoCapitalize="none" autoCorrect="off" spellCheck="false"
                />
                <div style={{display:"flex",gap:"8px"}}>
                  <button className="btn btn-outline" style={{flex:1,padding:"12px"}} onClick={() => { setDeleteStep(0); setDeleteConfirmText(""); }}>Cancel</button>
                  <button
                    className="btn btn-danger"
                    style={{flex:2,padding:"12px",opacity: deleteConfirmText==="DELETE" ? 1 : 0.4, pointerEvents: deleteConfirmText==="DELETE" ? "all" : "none"}}
                    onClick={onDeleteAccount}
                  >🗑 Erase Everything</button>
                </div>
              </div>
            )}
          </div>

          {/* ── Advanced ── */}
          <div>
            <div style={{fontSize:"12px",fontWeight:"700",color:"var(--muted2)",letterSpacing:".1em",textTransform:"uppercase",padding:"0 14px 8px"}}>Advanced</div>
            <SettingsSectionCard>
              {/* Toggle row */}
              <div
                className="settings-item"
                style={{cursor:"pointer", borderBottom: showAdvanced ? "0.5px solid var(--border)" : "none"}}
                onClick={() => setShowAdvanced(v => !v)}
              >
                <div className="settings-item-left">
                  <div className="settings-item-label">ATO rate, goals, fuel &amp; scoring</div>
                  <div className="settings-item-sub">Tap to {showAdvanced ? "collapse" : "expand"}</div>
                </div>
                <span style={{fontSize:"14px",color:"var(--muted2)",transform: showAdvanced ? "rotate(90deg)" : "none",transition:"transform .2s ease",display:"inline-block"}}>›</span>
              </div>

            {showAdvanced && (
              <>
                {/* ATO Rate */}
                <div className="settings-item" style={{borderBottom:"0.5px solid var(--border)"}}>
                  <div className="settings-item-left">
                    <div className="settings-item-label">ATO Cents/km Rate</div>
                    <div className="settings-item-sub">FY{ATO_FY_LABEL} default: ${ATO_RATE_PER_KM.toFixed(2)}</div>
                  </div>
                  <input className="settings-input" type="number" step="0.01" min="0" value={rate} onChange={e => setRate(e.target.value)} />
                </div>

                {/* Weekly Goal */}
                <div className="settings-item" style={{borderBottom:"0.5px solid var(--border)"}}>
                  <div className="settings-item-left">
                    <div className="settings-item-label">Weekly Earnings Goal</div>
                    <div className="settings-item-sub">Shown as progress on home screen</div>
                  </div>
                  <div style={{display:"flex",alignItems:"center",gap:"4px"}}>
                    <span style={{color:"var(--muted2)",fontSize:"13px"}}>$</span>
                    <input className="settings-input" type="number" min="0" step="50" value={goalInput} onChange={e => setGoalInput(e.target.value)} />
                  </div>
                </div>

                {/* Fuel efficiency */}
                <div className="settings-item" style={{borderBottom:"0.5px solid var(--border)"}}>
                  <div className="settings-item-left">
                    <div className="settings-item-label">Fuel Efficiency</div>
                    <div className="settings-item-sub">L/100km</div>
                  </div>
                  <div style={{display:"flex",alignItems:"center",gap:"4px"}}>
                    <input className="settings-input" type="number" min="0" step="0.1" placeholder="8.5" value={fuelEff} onChange={e => setFuelEff(e.target.value)} />
                    <span style={{fontSize:"11px",color:"var(--muted2)"}}>L</span>
                  </div>
                </div>

                {/* Fuel price */}
                <div className="settings-item" style={{borderBottom:"0.5px solid var(--border)"}}>
                  <div className="settings-item-left">
                    <div className="settings-item-label">Fuel Price</div>
                    <div className="settings-item-sub">Current pump price</div>
                  </div>
                  <div style={{display:"flex",alignItems:"center",gap:"4px"}}>
                    <span style={{color:"var(--muted2)",fontSize:"13px"}}>$</span>
                    <input className="settings-input" type="number" min="0" step="0.01" placeholder="2.05" value={fuelPr} onChange={e => setFuelPr(e.target.value)} />
                  </div>
                </div>

                {/* Scoring targets */}
                <div style={{padding:"13px 15px"}}>
                  <div style={{fontSize:"12px",fontWeight:"700",color:"var(--muted2)",letterSpacing:".08em",textTransform:"uppercase",marginBottom:"10px"}}>
                    Scoring Targets {!isPro && <span style={{fontSize:"10px",color:"var(--purple)",background:"var(--purple-dim)",padding:"2px 7px",borderRadius:"10px",marginLeft:"6px"}}>Pro</span>}
                  </div>
                  {!isPro ? (
                    <div style={{textAlign:"center",padding:"12px 0"}}>
                      <div style={{fontSize:"12px",color:"var(--muted)",marginBottom:"10px"}}>Unlock custom scoring targets with Pro.</div>
                      <button onClick={onUpgrade} style={{padding:"9px 20px",background:"var(--green)",color:"#0B0F14",border:"none",borderRadius:"8px",fontSize:"12px",fontWeight:"700",cursor:"pointer"}}>Upgrade to Pro →</button>
                    </div>
                  ) : (
                    <>
                      {[
                        {label:"Hourly Rate",  value:tHourly,     set:setTHourly,     pre:"$",suf:"/hr"},
                        {label:"Per Delivery", value:tPerDel,     set:setTPerDel,     pre:"$",suf:""},
                        {label:"Active KM%",   value:tActiveKm,   set:setTActiveKm,   pre:"", suf:"%"},
                        {label:"Active Time%", value:tActiveTime, set:setTActiveTime, pre:"", suf:"%"},
                      ].map(({label,value,set,pre,suf}) => (
                        <div key={label} className="settings-item" style={{padding:"10px 0",borderTop:"0.5px solid var(--border)"}}>
                          <div className="settings-item-label" style={{fontSize:"12px"}}>{label}</div>
                          <div style={{display:"flex",alignItems:"center",gap:"4px"}}>
                            {pre && <span style={{color:"var(--muted2)",fontSize:"13px"}}>{pre}</span>}
                            <input className="settings-input" type="number" min="0" step="0.5" value={value} onChange={e => set(e.target.value)} style={{width:"70px"}} />
                            {suf && <span style={{color:"var(--muted2)",fontSize:"13px"}}>{suf}</span>}
                          </div>
                        </div>
                      ))}
                      {isCustom && (
                        <button className="btn btn-outline" style={{width:"100%",padding:"10px",fontSize:"12px",marginTop:"8px"}} onClick={resetTargets}>↺ Reset Defaults</button>
                      )}
                    </>
                  )}
                </div>
              </>
            )}
            </SettingsSectionCard>
          </div>

          {/* ── Save button ── */}
          <div style={{padding:"0 14px"}}>
            <button
              className="btn-save"
              style={{background: saved ? "var(--green)" : "var(--green)", transition:"all .3s ease"}}
              onClick={save}
            >
              {saved ? "✓ Saved!" : "Save Settings"}
            </button>
          </div>

          <div className="version-tag">GIGTRACK · FOR DELIVERY DRIVERS · ATO {ATO_FY_LABEL}</div>
        </div>
      </div>
    </div>
  );
}

// ─── ORDER SESSION SCREEN ───
function OrderSessionScreen({ onBack, onFinish, atoRate }) {
  const [orders, setOrders]       = useState(() => DB.get("gt_active_orders") || []);
  const [showModal, setShowModal] = useState(false);

  // Modal form state
  const [mEarned, setMEarned] = useState("");
  const [mKm,     setMKm]     = useState("");
  const [mMins,   setMMins]   = useState("");
  const [mNote,   setMNote]   = useState("");
  const [mErr,    setMErr]    = useState("");

  const persist = (o) => { setOrders(o); DB.set("gt_active_orders", o); };

  const totals = orders.reduce((acc, o) => ({
    earned: acc.earned + o.earned,
    km:     acc.km + o.km,
    mins:   acc.mins + o.mins,
  }), { earned: 0, km: 0, mins: 0 });

  const resetModal = () => {
    setMEarned(""); setMKm(""); setMMins(""); setMNote(""); setMErr("");
  };

  const handleAddOrder = () => {
    const earned = parseFloat(mEarned);
    const km     = parseFloat(mKm) || 0;
    const mins   = parseFloat(mMins) || 0;
    if (isNaN(earned) || earned <= 0) { setMErr("Please enter earnings for this order."); return; }
    const order = { id: Date.now(), earned, km, mins, note: mNote.trim() };
    const updated = [...orders, order];
    persist(updated);
    resetModal();
    setShowModal(false);
  };

  const handleDeleteOrder = (id) => {
    persist(orders.filter(o => o.id !== id));
  };

  const handleFinish = () => {
    if (!orders.length) return;
    DB.remove("gt_active_orders");
    // Detect platform across all orders
    const plats = orders.map(o => o.platform).filter(Boolean);
    const hasUE = plats.includes("uber_eats");
    const hasDD = plats.includes("doordash");
    const platform = hasUE && hasDD ? "both" : hasUE ? "uber_eats" : hasDD ? "doordash" : null;
    onFinish({
      totalEarned: totals.earned,
      totalKm:     totals.km,
      totalMin:    totals.mins,
      dels:        orders.length,
      platform,
      orderBreakdown: orders,
    });
  };

  return (
    <div className="view active" style={{background:"var(--bg)"}}>
      <div className="order-session-header">
        <div style={{display:"flex",alignItems:"center",gap:"12px"}}>
          <button className="topbar-back" onClick={onBack}>←</button>
          <div className="topbar-title">Order-by-Order</div>
          <div style={{marginLeft:"auto",display:"flex",gap:"8px"}}>
            <button className="import-btn" onClick={() => { resetModal(); setShowModal(true); }}>＋ Add Order</button>
          </div>
        </div>
        <div className="order-running-totals">
          <div className="order-total-card">
            <div className="order-total-label">Total Earned</div>
            <div className="order-total-value" style={{color:"var(--green)"}}>${totals.earned.toFixed(2)}</div>
          </div>
          <div className="order-total-card">
            <div className="order-total-label">Total KMs</div>
            <div className="order-total-value">{totals.km.toFixed(1)}</div>
          </div>
          <div className="order-total-card">
            <div className="order-total-label">Orders</div>
            <div className="order-total-value">{orders.length}</div>
          </div>
        </div>
      </div>

      <div className="scroll-area" style={{padding:"14px 14px 0"}}>
        {!orders.length ? (
          <div className="empty-state" style={{padding:"40px 20px"}}>
            <div className="empty-icon">📦</div>
            <div className="empty-title">No orders yet</div>
            <div className="empty-sub">Tap "＋ Add Order" to get started.</div>
          </div>
        ) : orders.map((o, i) => (
          <div key={o.id} className="order-card">
            <div className="order-card-num">ORDER {i + 1}</div>
            <button className="order-delete-btn" onClick={() => handleDeleteOrder(o.id)}>✕</button>
            <div className="order-card-stats">
              <div className="order-card-stat">
                <div className="order-card-stat-label">EARNED</div>
                <div className="order-card-stat-value" style={{color:"var(--green)"}}>${o.earned.toFixed(2)}</div>
              </div>
              <div className="order-card-stat">
                <div className="order-card-stat-label">KMs</div>
                <div className="order-card-stat-value">{o.km.toFixed(1)}</div>
              </div>
              <div className="order-card-stat">
                <div className="order-card-stat-label">TIME</div>
                <div className="order-card-stat-value">{o.mins} min</div>
              </div>
            </div>
            {o.note && <div style={{fontSize:"11px",color:"var(--muted)",marginTop:"8px",fontStyle:"italic"}}>"{o.note}"</div>}
          </div>
        ))}

        <button className="add-order-btn" onClick={() => { resetModal(); setShowModal(true); }}>
          ＋ Add Another Order
        </button>
      </div>

      {/* Add Order Modal */}
      {showModal && (
        <div className="order-modal-overlay" onClick={e => e.target.className === "order-modal-overlay" && setShowModal(false)}>
          <div className="order-modal">
            <div className="order-modal-title">📦 Order {orders.length + 1}</div>
            <div className="input-group">
              <div className="input-row">
                <div className="input-label">Earnings for this order ($) *</div>
                <input className={`input-field${mErr?" err":""}`} type="number" min="0" step="0.01" placeholder="e.g. 8.50" value={mEarned} onChange={e => { setMEarned(e.target.value); setMErr(""); }} />
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"10px"}}>
                <div className="input-row">
                  <div className="input-label">Distance (km)</div>
                  <input className="input-field" type="number" min="0" step="0.1" placeholder="e.g. 4.2" value={mKm} onChange={e => setMKm(e.target.value)} />
                </div>
                <div className="input-row">
                  <div className="input-label">Delivery time (min)</div>
                  <input className="input-field" type="number" min="0" placeholder="e.g. 18" value={mMins} onChange={e => setMMins(e.target.value)} />
                </div>
              </div>
              <div className="input-row">
                <div className="input-label">Note (optional)</div>
                <input className="input-field" placeholder="e.g. Long wait at restaurant" value={mNote} onChange={e => setMNote(e.target.value)} />
              </div>
              {mErr && <div className="val-msg show">{mErr}</div>}
            </div>
            <div style={{display:"flex",gap:"8px",marginTop:"16px"}}>
              <button className="btn btn-outline" style={{flex:1,padding:"14px"}} onClick={() => setShowModal(false)}>Cancel</button>
              <button className="btn btn-primary" style={{flex:2,padding:"14px"}} onClick={handleAddOrder}>Save Order</button>
            </div>
          </div>
        </div>
      )}

      <div className="finish-shift-bar">
        <button className="finish-shift-btn" disabled={!orders.length} onClick={handleFinish}>
          {orders.length ? `✓ Finish Shift (${orders.length} order${orders.length !== 1 ? "s" : ""} · $${totals.earned.toFixed(2)})` : "Add at least one order"}
        </button>
      </div>
    </div>
  );
}

// ─── ROOT APP ───
export default function GigTrack() {
  const [screen, setScreen]     = useState("loading");
  const [user, setUser]         = useState(null);
  const [authUser, setAuthUser] = useState(null); // Supabase auth user (cloud identity)
  const [trips, setTrips]       = useState([]);
  const [kmPref, setKmPref]     = useState("active");
  const [atoRate, setAtoRate]   = useState(ATO_RATE_PER_KM);
  const [targets, setTargets]   = useState(DEFAULT_TARGETS);
  const [weeklyGoal, setWeeklyGoal] = useState(800);
  const [fuelEfficiency, setFuelEfficiency] = useState(null);
  const [fuelPrice, setFuelPrice]           = useState(null);
  const [region, setRegion]                 = useState(null);
  const [theme, setTheme] = useState(() => DB.get("gt_theme") || "light"); // 'light' | 'dark' | 'system'
  const [editId, setEditId]         = useState(null);
  const [detailId, setDetailId]     = useState(null);
  const [activeShift, setActiveShift] = useState(null);
  const [timerPrefill, setTimerPrefill] = useState(null);
  const [toast, setToast]           = useState("");
  const [confirm, setConfirm]   = useState(null);
  const [liveStatus, setLiveStatus] = useState(null); // {online, platform, zone, since}
  const [platformPickerOpen, setPlatformPickerOpen] = useState(false);
  const [signInOpen, setSignInOpen] = useState(false);
  const toastTimer = useRef(null);

  // ── Theme management ──
  useEffect(() => {
    const apply = (t) => {
      const resolved = t === "system"
        ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
        : t;
      document.documentElement.dataset.theme = resolved;
    };
    apply(theme);
    DB.set("gt_theme", theme);
    if (theme === "system") {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      const handler = () => apply("system");
      mq.addEventListener("change", handler);
      return () => mq.removeEventListener("change", handler);
    }
  }, [theme]);

  // ── Supabase auth + routing on boot ──
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!mounted) return;
        setAuthUser(user);
        if (user) {
          console.log("[GigTrack] Supabase auth user:", user.id);
        } else {
          console.log("[GigTrack] No auth session — routing to welcome");
        }
      } catch (e) {
        console.warn("[GigTrack] Supabase auth check failed:", e.message);
      }
    })();
    // Subscribe to future auth state changes (sign in/out)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return;
      const newUser = session?.user || null;
      setAuthUser(prev => {
        // Detect sign-in (prev was null/undefined, now there's a user)
        if (!prev && newUser) {
          // ── SECURITY: If a DIFFERENT user is signing in than was previously seen
          // on this device, wipe all local state before doing anything else. This
          // prevents one user's localStorage data from being pushed to another user's
          // cloud account during reconciliation. ──
          const lastUid = DB.get("gt_last_user_id");
          if (lastUid && lastUid !== newUser.id) {
            console.warn("[GigTrack] User switch detected — wiping local data for safety. Was:", lastUid, "Now:", newUser.id);
            DB.remove("gt_user");
            DB.remove("gt_trips");
            DB.remove("gt_region");
            DB.remove("gt_kmpref");
            DB.remove("gt_weeklygoal");
            DB.remove("gt_fuel_efficiency");
            DB.remove("gt_fuel_price");
            DB.remove("gt_activeshift");
            DB.remove("gt_live_status");
            DB.remove("gt_voice_prefill");
            DB.remove("gt_deleted_seeds");
            setUser(null);
            setTrips([]);
            setRegion(null);
            setKmPref("active");
            setWeeklyGoal(800);
            setFuelEfficiency(null);
            setFuelPrice(null);
            setActiveShift(null);
            setLiveStatus(null);
            reconciledRef.current = false;
          }
          DB.set("gt_last_user_id", newUser.id);

          // Async — fetch profile and route appropriately
          (async () => {
            const profile = await fetchProfile();
            if (profile && profile.name) {
              // Returning user — hydrate state from profile
              const u = {
                name: profile.name,
                email: profile.email,
                startOdo: profile.start_odo,
                isGuest: !!profile.is_guest,
                isPro: !!profile.is_pro,
              };
              DB.set("gt_user", u);
              setUser(u);
              if (profile.region) {
                setRegion(profile.region);
                DB.set("gt_region", profile.region);
              }
              if (profile.km_pref) {
                setKmPref(profile.km_pref);
                DB.set("gt_kmpref", profile.km_pref);
              }
              if (profile.weekly_goal != null) {
                setWeeklyGoal(profile.weekly_goal);
                DB.set("gt_weeklygoal", profile.weekly_goal);
              }
              if (profile.fuel_eff != null) {
                setFuelEfficiency(profile.fuel_eff);
                DB.set("gt_fuel_efficiency", profile.fuel_eff);
              }
              if (profile.fuel_price != null) {
                setFuelPrice(profile.fuel_price);
                DB.set("gt_fuel_price", profile.fuel_price);
              }
              showToast(`Welcome back, ${profile.name}!`);
              setScreen("home");
              reconciledRef.current = false;

              // Pull cloud shifts into local
              const cloudShifts = await fetchAllShifts();
              if (cloudShifts.length > 0) {
                const localTrips = DB.get("gt_trips") || [];
                const localIds = new Set(localTrips.map(t => t.id));
                const newOnes = cloudShifts.filter(t => !localIds.has(t.id));
                const merged = [...localTrips, ...newOnes];
                DB.set("gt_trips", merged);
                setTrips(merged);
              }
            } else {
              // First-time sign-in — no profile yet, send through onboarding
              showToast(`Signed in as ${newUser.email}`);
              setScreen("setup");
            }
          })();
        }
        // Detect sign-out (had a user, now null)
        if (prev && !newUser) {
          // Wipe everything and go to welcome
          setUser(null);
          setTrips([]);
          setRegion(null);
          setKmPref("active");
          setWeeklyGoal(800);
          setFuelEfficiency(null);
          setFuelPrice(null);
          DB.remove("gt_user");
          DB.remove("gt_trips");
          DB.remove("gt_region");
          DB.remove("gt_kmpref");
          DB.remove("gt_weeklygoal");
          DB.remove("gt_fuel_efficiency");
          DB.remove("gt_fuel_price");
          DB.remove("gt_last_user_id");
          reconciledRef.current = false;
          setScreen("welcome");
        }
        return newUser;
      });
    });
    return () => {
      mounted = false;
      subscription?.unsubscribe();
    };
  }, []);

  // ── Boot-time cloud reconciliation: push any local shifts not yet in cloud ──
  const reconciledRef = useRef(false);
  useEffect(() => {
    if (reconciledRef.current) return;          // already done this session
    if (!authUser) return;                       // wait for auth
    if (!trips || trips.length === 0) return;    // wait for localStorage hydration
    reconciledRef.current = true;
    reconcileShifts(trips).catch(() => {});      // fire-and-forget
  }, [authUser, trips]);

  // ── Boot ──
  useEffect(() => {
    const u = DB.get("gt_user");
    let t = DB.get("gt_trips") || [];

    // ── One-time migration: 1.5× totalKm for seed shifts to account for return-home trips ──
    // Identifies seeds by either __seed flag or by matching SEED_SHIFTS ids.
    // Recomputes the trip's downstream fields (totalKm, kmDel, deduction, score, hourly, etc).
    if (!DB.get("gt_migrated_seed_km_1p5x_v1")) {
      const seedIds = new Set(SEED_SHIFTS.map(s => s.id));
      t = t.map(trip => {
        if (!(trip.__seed === true || seedIds.has(trip.id))) return trip;
        const newTotalKm = +(trip.totalKm * 1.5).toFixed(2);
        // Recompute via computeTrip so all derived fields stay consistent
        const inputs = {
          base: trip.base, tip: trip.tip, bonus: trip.bonus,
          tDel: trip.tDel, tWait: trip.tWait,
          activeMin: trip.activeMin ?? trip.activeMins ?? null,
          activeKmInput: trip.activeKm ?? null,
          kmDel: newTotalKm, kmWait: 0,
          dels: trip.dels, expenses: trip.expenses || 0,
        };
        const c = computeTrip(inputs);
        return {
          ...trip,
          ...inputs,
          ...c,
          totalKm: newTotalKm,
          deduction: newTotalKm * ATO_RATE_PER_KM,
        };
      });
      DB.set("gt_trips", t);
      DB.set("gt_migrated_seed_km_1p5x_v1", true);
    }

    // ── One-time migration: 1.2× activeKm for seed shifts to reflect more accurate delivery km ──
    if (!DB.get("gt_migrated_seed_activekm_1p2x_v1")) {
      const seedIds = new Set(SEED_SHIFTS.map(s => s.id));
      t = t.map(trip => {
        if (!(trip.__seed === true || seedIds.has(trip.id))) return trip;
        if (trip.activeKm == null) return trip;
        const newActiveKm = +(trip.activeKm * 1.2).toFixed(2);
        const inputs = {
          base: trip.base, tip: trip.tip, bonus: trip.bonus,
          tDel: trip.tDel, tWait: trip.tWait,
          activeMin: trip.activeMin ?? trip.activeMins ?? null,
          activeKmInput: newActiveKm,
          kmDel: trip.totalKm, kmWait: 0,
          dels: trip.dels, expenses: trip.expenses || 0,
        };
        const c = computeTrip(inputs);
        return {
          ...trip,
          ...inputs,
          ...c,
          activeKm: newActiveKm,
        };
      });
      DB.set("gt_trips", t);
      DB.set("gt_migrated_seed_activekm_1p2x_v1", true);
    }

    // Note: SEED_SHIFTS no longer auto-merged for new users.
    // Anyone with seed shifts already in localStorage keeps them; future installs start empty.
    const k = DB.get("gt_kmpref") || "active";
    const r = DB.get("gt_atorate") || ATO_RATE_PER_KM;
    const tg = DB.get("gt_targets") || DEFAULT_TARGETS;
    const wg = DB.get("gt_weeklygoal");
    const fe = DB.get("gt_fuel_efficiency");
    const fp = DB.get("gt_fuel_price");
    const rg = DB.get("gt_region");
    const a = DB.get("gt_activeshift") || null;
    const ls = DB.get("gt_live_status") || null;
    setTrips(t);
    setKmPref(k);
    setAtoRate(r);
    setTargets(tg);
    if (wg != null) setWeeklyGoal(wg);
    if (fe != null) setFuelEfficiency(fe);
    if (fp != null) setFuelPrice(fp);
    if (rg != null) setRegion(rg);
    if (ls && ls.online) setLiveStatus(ls);
    if (a) {
      setActiveShift(a);
      // If there was an active shift, go straight back to the shift screen
      if (u) setScreen("activeshift");
    }
    // Auth gate: only go to home if there's both a stored user AND we'll re-validate
    // the session via the supabase auth effect. Otherwise route to welcome.
    // (The supabase auth effect runs separately; if it finds no session, the user
    // already saw welcome here. If it finds a session, it'll route them properly.)
    const hasAuthSession = !!DB.get("gt_supabase_auth"); // supabase persistence key
    if (u && hasAuthSession && !a) { setUser(u); setScreen("home"); }
    else if (u && hasAuthSession && a) { setUser(u); }
    else setScreen("welcome");
  }, []);

  const showToast = (msg) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 2400);
  };

  const saveUser = (u) => {
    DB.set("gt_user", u);
    setUser(u);
  };

  const handleDeleteAccount = () => {
    // Wipe every known localStorage key
    ["gt_user","gt_trips","gt_kmpref","gt_atorate","gt_targets","gt_weeklygoal",
     "gt_fuel_efficiency","gt_fuel_price","gt_region","gt_activeshift",
     "gt_active_orders","gt_order_prefill","gt_live_status"].forEach(k => DB.remove(k));
    // Reset all app state
    setUser(null);
    setTrips([]);
    setKmPref("active");
    setAtoRate(ATO_RATE_PER_KM);
    setTargets(DEFAULT_TARGETS);
    setWeeklyGoal(800);
    setFuelEfficiency(null);
    setFuelPrice(null);
    setRegion(null);
    setActiveShift(null);
    setLiveStatus(null);
    setEditId(null);
    setDetailId(null);
    setTimerPrefill(null);
    setScreen("setup");
  };

  const handleSetupComplete = (data) => {
    const u = { name: data.name, email: data.email, startOdo: data.startOdo, isGuest: data.isGuest !== false, isPro: !!data.isPro };
    saveUser(u);
    setKmPref(data.kmPref);
    DB.set("gt_kmpref", data.kmPref);
    if (data.region) { setRegion(data.region); DB.set("gt_region", data.region); }
    setScreen("home");
    // Sync profile to cloud — fire-and-forget
    saveProfile({
      name: u.name,
      region: data.region,
      kmPref: data.kmPref,
      weeklyGoal: weeklyGoal,
      isPro: u.isPro,
      isGuest: u.isGuest,
      startOdo: u.startOdo,
    }).catch(() => {});
  };

  const handleStartTimer = () => {
    const shift = { startedAt: Date.now(), resumedAt: Date.now(), elapsed: 0, paused: false };
    setActiveShift(shift);
    DB.set("gt_activeshift", shift);
    setScreen("activeshift");
  };

  const handlePauseTimer = () => {
    setActiveShift(prev => {
      const elapsed = (prev.elapsed || 0) + (Date.now() - prev.resumedAt);
      const updated = { ...prev, paused: true, elapsed };
      DB.set("gt_activeshift", updated);
      return updated;
    });
  };

  const handleResumeTimer = () => {
    setActiveShift(prev => {
      const updated = { ...prev, paused: false, resumedAt: Date.now() };
      DB.set("gt_activeshift", updated);
      return updated;
    });
  };

  const handleEndTimer = (totalMin, totalKm) => {
    const startedAt = activeShift.startedAt;
    DB.remove("gt_activeshift");
    setActiveShift(null);
    setTimerPrefill({ startedAt, totalMin, totalKm });
    setEditId(null);
    setScreen("newtrip");
  };

  const handleSaved = (rawRecord, isEdit) => {
    // Tag with owner user id for safety. Prevents this shift from being
    // pushed to a different user's cloud account if accounts switch on this device.
    const record = { ...rawRecord, _owner: authUser?.id || null };

    let updated;
    if (isEdit) {
      updated = trips.map(t => t.id === record.id ? record : t);
      showToast("Shift updated ✅");
    } else {
      updated = [...trips, record];
      showToast("Shift saved 🎉");
    }
    setTrips(updated);
    DB.set("gt_trips", updated);
    setEditId(null);
    setTimerPrefill(null);

    // Cloud sync — fire and forget. If it fails (offline, etc), the synced
    // flag stays false and Pass 4's reconciliation will catch it on next boot.
    syncShift(record).then(result => {
      if (result.ok) {
        // Mark this shift as synced in localStorage
        const synced = trips.map(t => t.id === record.id ? { ...record, _synced: true } : t);
        // If it was a new insert, the trip we want is in `updated` but not yet in state
        const finalList = isEdit
          ? synced
          : [...trips, { ...record, _synced: true }];
        DB.set("gt_trips", finalList);
        setTrips(finalList);
      }
    });

    setTimeout(() => {
      if (isEdit) { setDetailId(record.id); setScreen("detail"); }
      else setScreen("home");
    }, 700);
  };

  const handleDelete = (id) => {
    setConfirm({
      title: "Delete this shift?",
      sub: "This cannot be undone.",
      onConfirm: () => {
        const updated = trips.filter(t => t.id !== id);
        setTrips(updated);
        DB.set("gt_trips", updated);
        // If this was a seed shift, remember it so it doesn't respawn on next boot
        const wasSeed = SEED_SHIFTS.some(s => s.id === id);
        if (wasSeed) {
          const deletedSeeds = DB.get("gt_deleted_seeds") || [];
          if (!deletedSeeds.includes(id)) {
            DB.set("gt_deleted_seeds", [...deletedSeeds, id]);
          }
        }
        // Cloud delete — fire and forget. Local delete is the source of truth.
        deleteShiftCloud(id);
        setConfirm(null);
        showToast("Shift deleted");
        setScreen("log");
      },
    });
  };

  const handleEdit = (id) => { setEditId(id); setScreen("newtrip"); };

  const handleOrderFinish = (prefill) => {
    setTimerPrefill({
      startedAt: Date.now(),
      totalMin: prefill.totalMin,
    });
    DB.set("gt_order_prefill", prefill); // includes platform
    setEditId(null);
    setScreen("newtrip");
  };

  const currentTrip = trips.find(t => t.id === detailId);
  const editTrip    = trips.find(t => t.id === editId);

  const isPro = !!user?.isPro;

  const upgradeToPro = () => {
    const updated = { ...user, isPro: true, isGuest: false };
    saveUser(updated);
    setScreen("home");
    showToast("Welcome to GigTrack Pro 🚀");
  };

  if (screen === "loading") return null;

  const mainScreens = ["home", "log", "insights", "settings"];
  const showNav = mainScreens.includes(screen) || screen === "logshift";

  const navProps = {
    onHome:     () => setScreen("home"),
    onLogShift: () => setScreen("logshift"),
    onLog:      () => setScreen("log"),
    onInsights: () => setScreen("insights"),
    onSettings: () => setScreen("settings"),
  };

  return (
    <>
      <style>{css}</style>
      {screen === "welcome" && (
        <WelcomeScreen
          onSignIn={() => setSignInOpen(true)}
        />
      )}
      {screen === "setup" && <SetupScreen onComplete={handleSetupComplete} />}
      {screen === "paywall" && (
        <PremiumPaywallScreen
          onBack={() => setScreen("settings")}
          onSubscribe={() => upgradeToPro()}
        />
      )}
      {screen === "home" && (
        <HomeScreen
          user={user} trips={trips} kmPref={kmPref}
          activeShift={activeShift}
          weeklyGoal={weeklyGoal}
          region={region}
          isPro={isPro}
          liveStatus={liveStatus}
          onGoOnline={() => setPlatformPickerOpen(true)}
          onGoOffline={() => {
            setLiveStatus(null);
            DB.remove("gt_live_status");
            showToast("You're offline");
          }}
          onStartTimer={handleStartTimer}
          onEndTimer={handleEndTimer}
          onPauseTimer={handlePauseTimer}
          onResumeTimer={handleResumeTimer}
          onResumeShiftScreen={() => setScreen("activeshift")}
          onNewTrip={() => { setTimerPrefill(null); setEditId(null); setScreen("newtrip"); }}
          onOrderSession={() => setScreen("ordersession")}
          onViewLog={() => setScreen("log")}
          onSettings={() => setScreen("settings")}
          onUpgrade={() => setScreen("paywall")}
          onLogShift={() => setScreen("logshift")}
          onDetail={(id) => { setDetailId(id); setScreen("detail"); }}
        />
      )}
      {screen === "logshift" && (
        <LogShiftScreen
          isPro={isPro}
          onBack={() => setScreen("home")}
          onStartTimer={() => { handleStartTimer(); }}
          onNewTrip={() => { setTimerPrefill(null); setEditId(null); setScreen("newtrip"); }}
          onVoiceEntry={() => setScreen("voiceentry")}
          onScreenshotImport={() => setScreen("screenshotimport")}
          onUpgrade={() => setScreen("paywall")}
        />
      )}
      {screen === "screenshotimport" && (
        <ScreenshotImportScreen
          onBack={() => setScreen("logshift")}
          onParsed={(finalValues) => {
            // finalValues comes from the editable preview with keys:
            // earned, tips, bonus, dels, mins, activeMin, km, activeKm, platform, shiftDate, notes
            // Build a complete trip record, save locally + cloud, route home.

            const earned   = Number(finalValues.earned)   || 0;
            const tip      = Number(finalValues.tips)     || 0;
            const bonus    = Number(finalValues.bonus)    || 0;
            const base     = Math.max(0, earned - tip - bonus);  // base = total minus tip and bonus
            const dels     = parseInt(finalValues.dels)   || 0;
            const totalMin = parseInt(finalValues.mins)   || 0;
            const activeMin = finalValues.activeMin != null ? parseInt(finalValues.activeMin) : null;
            const totalKm  = Number(finalValues.km)       || 0;
            const activeKm = finalValues.activeKm != null ? Number(finalValues.activeKm) : null;
            const platform = finalValues.platform || null;
            const notes    = finalValues.notes || null;

            // Build timestamp from shiftDate (YYYY-MM-DD) + current time
            // If shiftDate is today, use right now. Otherwise use noon of that date.
            let ts;
            if (finalValues.shiftDate) {
              const today = new Date().toISOString().slice(0, 10);
              if (finalValues.shiftDate === today) {
                ts = new Date().toISOString();
              } else {
                // Past date — set to noon local
                ts = new Date(finalValues.shiftDate + "T12:00:00").toISOString();
              }
            } else {
              ts = new Date().toISOString();
            }

            const inputs = {
              base, tip, bonus,
              tDel: totalMin, tWait: 0,
              activeMin, activeKmInput: activeKm,
              kmDel: totalKm, kmWait: 0,
              dels, expenses: 0,
            };
            const c = computeTrip(inputs, targets);

            const record = {
              id: Date.now(),
              ts,
              platform,
              base, tip, bonus,
              totalEarned: earned,
              tDel: totalMin, tWait: 0,
              totalMin, totalHrs: c.totalHrs,
              activeMin, activeMins: c.activeMins,
              kmDel: totalKm, kmWait: 0,
              totalKm, activeKm,
              dels, expenses: 0,
              hourly: c.hourly, perDel: c.perDel, perKm: c.perKm,
              ratioT: c.ratioA, ratioK: c.ratioK,
              score: c.score,
              deduction: totalKm * ATO_RATE_PER_KM,
              notes,
            };

            handleSaved(record, false);
          }}
        />
      )}
      {screen === "voiceentry" && (
        <VoiceEntryScreen
          onBack={() => setScreen("logshift")}
          onParsed={(parsed) => {
            // Stash parsed values in localStorage so NewTripScreen picks them up
            const prefill = {};
            if (parsed.earned   != null) prefill.earned   = parsed.earned;
            if (parsed.tips     != null) prefill.tips     = parsed.tips;
            if (parsed.bonus    != null) prefill.bonus    = parsed.bonus;
            if (parsed.km       != null) prefill.km       = parsed.km;
            if (parsed.dels     != null) prefill.dels     = parsed.dels;
            if (parsed.mins     != null) prefill.mins     = parsed.mins;
            if (parsed.platform != null) prefill.platform = parsed.platform;
            DB.set("gt_voice_prefill", prefill);
            setTimerPrefill(null);
            setEditId(null);
            setScreen("newtrip");
          }}
        />
      )}
      {screen === "activeshift" && activeShift && (
        <ActiveShiftScreen
          activeShift={activeShift}
          onPause={handlePauseTimer}
          onResume={handleResumeTimer}
          onEnd={handleEndTimer}
        />
      )}
      {screen === "ordersession" && (
        <OrderSessionScreen
          onBack={() => setScreen("home")}
          onFinish={handleOrderFinish}
          atoRate={atoRate}
        />
      )}
      {screen === "newtrip" && (
        <NewTripScreen
          onBack={() => { setEditId(null); setTimerPrefill(null); setScreen(editId ? "detail" : "home"); }}
          onSaved={handleSaved}
          editTrip={editId ? editTrip : null}
          kmPref={kmPref}
          atoRate={atoRate}
          timerPrefill={timerPrefill}
          targets={targets}
          fuelEfficiency={fuelEfficiency}
          fuelPrice={fuelPrice}
          isPro={isPro}
          onFuelSave={(fe, fp) => {
            if (fe > 0) { setFuelEfficiency(fe); DB.set("gt_fuel_efficiency", fe); }
            if (fp > 0) { setFuelPrice(fp); DB.set("gt_fuel_price", fp); }
          }}
          onGoToSettings={() => setScreen("settings")}
          onUpgrade={() => setScreen("paywall")}
        />
      )}
      {screen === "log" && (
        <TripLogScreen
          trips={trips} kmPref={kmPref} user={user}
          fuelEfficiency={fuelEfficiency}
          fuelPrice={fuelPrice}
          isPro={isPro}
          onBack={() => setScreen("home")}
          onDetail={(id) => { setDetailId(id); setScreen("detail"); }}
          onUpgrade={() => setScreen("paywall")}
        />
      )}
      {screen === "detail" && (
        <DetailScreen
          trip={currentTrip} kmPref={kmPref}
          targets={targets}
          trips={trips}
          fuelEfficiency={fuelEfficiency}
          fuelPrice={fuelPrice}
          onBack={() => setScreen("log")}
          onEdit={handleEdit}
          onDelete={handleDelete}
          onGoToSettings={() => setScreen("settings")}
        />
      )}
      {screen === "insights" && (
        <InsightsScreen
          trips={trips}
          kmPref={kmPref}
          fuelEfficiency={fuelEfficiency}
          fuelPrice={fuelPrice}
        />
      )}
      {screen === "settings" && (
        <SettingsScreen
          user={user}
          trips={trips}
          onBack={() => setScreen("home")}
          onUpdateUser={saveUser}
          kmPref={kmPref}
          onKmPref={(p) => { setKmPref(p); DB.set("gt_kmpref", p); }}
          atoRate={atoRate}
          onAtoRate={(r) => { setAtoRate(r); DB.set("gt_atorate", r); }}
          targets={targets}
          onTargets={(t) => { setTargets(t); DB.set("gt_targets", t); }}
          weeklyGoal={weeklyGoal}
          onWeeklyGoal={(g) => { setWeeklyGoal(g); DB.set("gt_weeklygoal", g); }}
          fuelEfficiency={fuelEfficiency}
          onFuelEfficiency={(v) => { setFuelEfficiency(v); DB.set("gt_fuel_efficiency", v); }}
          fuelPrice={fuelPrice}
          onFuelPrice={(v) => { setFuelPrice(v); DB.set("gt_fuel_price", v); }}
          region={region}
          onRegion={(r) => {
            setRegion(r);
            DB.set("gt_region", r);
            // If region changed while online, go offline (presence is zone-specific)
            if (liveStatus?.online && liveStatus.zone !== r) {
              setLiveStatus(null);
              DB.remove("gt_live_status");
            }
          }}
          onDeleteAccount={handleDeleteAccount}
          isPro={isPro}
          onUpgrade={() => setScreen("paywall")}
          theme={theme}
          onTheme={setTheme}
          authUser={authUser}
          onSignIn={() => setSignInOpen(true)}
          onSignOut={() => {
            setConfirm({
              title: "Sign out?",
              sub: "Your data stays safely in the cloud. Sign back in anytime with the same email to access it.",
              onConfirm: async () => {
                setConfirm(null);
                await signOut();
                showToast("Signed out");
              },
            });
          }}
        />
      )}
      <ConfirmDialog
        show={!!confirm} title={confirm?.title || ""} sub={confirm?.sub || ""}
        onConfirm={confirm?.onConfirm} onCancel={() => setConfirm(null)}
      />
      <Toast msg={toast} />
      <PlatformPickerModal
        open={platformPickerOpen}
        onClose={() => setPlatformPickerOpen(false)}
        onPick={(platform) => {
          const status = {
            online: true,
            platform,
            zone: region,
            since: Date.now(),
          };
          setLiveStatus(status);
          DB.set("gt_live_status", status);
          setPlatformPickerOpen(false);
          showToast("You're online — visible to drivers in your zone");
        }}
      />
      <SignInModal
        open={signInOpen}
        onClose={() => setSignInOpen(false)}
        onSendLink={async (email) => await sendMagicLink(email)}
      />
      {showNav && (
        <BottomNav
          active={screen === "logshift" ? null : screen}
          {...navProps}
        />
      )}
    </>
  );
}
