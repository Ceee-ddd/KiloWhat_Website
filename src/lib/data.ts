export type Role = "Landlord" | "Tenant" | "Individual";
export type User = {
  id: string;
  name: string;
  role: Role;
  email: string;
  phone: string;
  property: string;
  status: "Active" | "Suspended";
  joined: string;
};

export const users: User[] = [
  { id: "USR-10241", name: "Maria Santos", role: "Landlord", email: "maria.santos@email.com", phone: "+63 917 552 8841", property: "Greenview Residence, Unit 15", status: "Active", joined: "Jan 12, 2024" },
  { id: "USR-10242", name: "Juan dela Cruz", role: "Tenant", email: "juan.delacruz@email.com", phone: "+63 918 221 4410", property: "Sunrise Tower, Unit 12A", status: "Active", joined: "Mar 05, 2024" },
  { id: "USR-10243", name: "Ana Reyes", role: "Individual", email: "ana.reyes@email.com", phone: "+63 919 774 1023", property: "East Homes Subdivision, Lot 4", status: "Active", joined: "Dec 18, 2023" },
  { id: "USR-10244", name: "Carlo Mendoza", role: "Tenant", email: "carlo.mendoza@email.com", phone: "+63 917 330 9921", property: "Greenview Residence, Unit 105-B", status: "Suspended", joined: "Jul 22, 2023" },
  { id: "USR-10245", name: "Elena Dimaculangan", role: "Landlord", email: "elena.d@email.com", phone: "+63 920 118 5532", property: "Villarosa Heights, Unit 15", status: "Active", joined: "Feb 29, 2024" },
  { id: "USR-10246", name: "Mark Sy", role: "Individual", email: "mark.sy@email.com", phone: "+63 915 662 0098", property: "Woodland Townhouses, Unit 3", status: "Active", joined: "Sep 09, 2023" },
  { id: "USR-10247", name: "Patricia Lopez", role: "Tenant", email: "patricia.l@email.com", phone: "+63 916 448 7710", property: "Sunrise Tower, Unit 8F", status: "Active", joined: "May 14, 2024" },
  { id: "USR-10248", name: "Ramon Valenzuela", role: "Tenant", email: "ramon.v@email.com", phone: "+63 917 909 3345", property: "Grand Heights Towers, Unit 22", status: "Suspended", joined: "Nov 02, 2023" },
];

export type ArchivedUser = { id: string; name: string; role: Role; email: string; property: string; archived: string; restorable: boolean };
export const archivedUsers: ArchivedUser[] = [
  { id: "A1", name: "Rosario Villanueva", role: "Landlord", email: "rosario.v@email.com", property: "Sunrise Tower, Unit 10A", archived: "Sep 18, 2026", restorable: true },
  { id: "A2", name: "Jomar Tan", role: "Tenant", email: "jomar.tan@email.com", property: "Sunrise Tower, Unit 12A", archived: "Sep 15, 2026", restorable: true },
  { id: "A3", name: "Liza Cabrera", role: "Individual", email: "liza.c@email.com", property: "East Homes Subdivision, Lot 9", archived: "Aug 11, 2026", restorable: true },
  { id: "A4", name: "Ernesto Manalo", role: "Tenant", email: "ernie.m@email.com", property: "Greenview Residence, Unit 7", archived: "Jul 22, 2026", restorable: false },
  { id: "A5", name: "Nina Bautista", role: "Landlord", email: "nina.b@email.com", property: "Villarosa Heights, Unit 15", archived: "Feb 29, 2026", restorable: false },
  { id: "A6", name: "Paolo Estrada", role: "Individual", email: "paolo.e@email.com", property: "Woodland Townhouses, Unit 9", archived: "Dec 09, 2025", restorable: false },
  { id: "A7", name: "Grace Domingo", role: "Tenant", email: "grace.d@email.com", property: "Sunrise Tower, Unit 8F", archived: "Dec 05, 2025", restorable: false },
  { id: "A8", name: "Ricardo Salazar", role: "Tenant", email: "ricky.s@email.com", property: "Grand Heights Towers, Unit 3", archived: "Nov 02, 2024", restorable: false },
];

export type UnitRow = { unit: string; owner: string; kwh: number; cost: number; change: number };
export const units: UnitRow[] = [
  { unit: "Unit 302-A", owner: "Maria Santos", kwh: 320.5, cost: 2724.25, change: -4.2 },
  { unit: "Unit 105-B", owner: "Juan Dela Cruz", kwh: 450.2, cost: 3826.7, change: 12.4 },
  { unit: "Unit 401-F", owner: "Ador Mawanay", kwh: 290.1, cost: 2465.85, change: -8.1 },
  { unit: "Unit 204-C", owner: "Patricia Gonzales", kwh: 510.8, cost: 4341.8, change: 15.3 },
  { unit: "Unit 112-D", owner: "Ramon Valenzuela", kwh: 180.4, cost: 1533.4, change: -2.5 },
  { unit: "Unit 309-B", owner: "Sarah Geronimo", kwh: 395.0, cost: 3357.5, change: 6.8 },
  { unit: "Unit 501-A", owner: "Lito Lapid", kwh: 612.3, cost: 5204.55, change: 18.2 },
  { unit: "Unit 202-F", owner: "Abigail Reyes", kwh: 275.6, cost: 2342.6, change: -9.6 },
];

export const dailyReadings = [
  { date: "Sep 10", reading: "18,652.4", kwh: 12.2, cost: 103.79, change: 13.3 },
  { date: "Sep 9", reading: "18,640.2", kwh: 10.8, cost: 91.63, change: -24.2 },
  { date: "Sep 8", reading: "18,629.4", kwh: 14.2, cost: 120.87, change: -0.4 },
  { date: "Sep 7", reading: "18,615.2", kwh: 14.3, cost: 121.3, change: 11.7 },
  { date: "Sep 6", reading: "18,600.9", kwh: 10.8, cost: 91.89, change: 18.1 },
  { date: "Sep 5", reading: "18,588.2", kwh: 12.8, cost: 108.55, change: 6.8 },
];

export type Severity = "Critical" | "Warning";
export type Anomaly = {
  id: string; unit: string; owner: string; type: string; short: string; detected: string;
  severity: Severity; status: "Open" | "Resolved"; badge: "danger" | "warn" | "info";
};
export const anomalies: Anomaly[] = [
  { id: "AF-20260922-0142", unit: "Unit 302-A", owner: "Maria Santos", type: "Overload", short: "Overload", detected: "Today, 10:14 AM", severity: "Critical", status: "Open", badge: "danger" },
  { id: "AF-20260922-0138", unit: "Unit 105-B", owner: "Ana Reyes (Individual)", type: "Reverse energy", short: "Reverse Energy", detected: "Today, 09:32 AM", severity: "Warning", status: "Open", badge: "danger" },
  { id: "AF-20260921-0127", unit: "Unit 401-F", owner: "Ador Mawanay", type: "Voltage sag", short: "Voltage Sag", detected: "Yesterday, 11:20 PM", severity: "Warning", status: "Open", badge: "warn" },
  { id: "AF-20261024-0101", unit: "Building C gateway", owner: "Main relay", type: "Offline meter", short: "Offline Meter", detected: "Oct 24, 02:15 PM", severity: "Warning", status: "Resolved", badge: "warn" },
  { id: "AF-20261023-0094", unit: "Unit 204-C", owner: "Patricia Gonzales", type: "Unusual surge", short: "Unusual Surge", detected: "Oct 23, 09:44 AM", severity: "Critical", status: "Open", badge: "info" },
];

export const activityLog = [
  { event: "Threshold Limit modified for Unit 302-A", actor: "Admin (Mike)", time: "10 mins ago" },
  { event: "Submeter #SM-2041 manually re-synced", actor: "System Gateway", time: "25 mins ago" },
  { event: "New tenant profile mapped: Unit 15", actor: "Property Mgr (John)", time: "1 hr ago" },
  { event: "Relay trip trigger test executed", actor: "Security Auditor", time: "3 hrs ago" },
  { event: "Firmware version v2.4 deployed to gateways", actor: "Admin (Mike)", time: "5 hrs ago" },
];

export const accountActivity = [
  { title: "Threshold limit modified to 150 kWh", actor: "Admin (Mike)", time: "10 mins ago" },
  { title: "Submeter #SM-2041 manually re-synced", actor: "System Gateway", time: "25 mins ago" },
  { title: "Profile mapped to Unit 15", actor: "Property Mgr (John)", time: "1 hr ago" },
  { title: "Overload anomaly acknowledged", actor: "Security Auditor", time: "3 hrs ago" },
  { title: "Account created and invitation sent", actor: "Admin (Mike)", time: "Jan 12, 2024" },
];

export const landlordUnits = [
  { unit: "Unit 302-A", occupant: "Juan dela Cruz", meter: "SM-2041", kwh: "320.5", cost: "₱2,724.25", status: "Active" },
  { unit: "Unit 105-B", occupant: "Carlo Mendoza", meter: "SM-2044", kwh: "450.2", cost: "₱3,826.70", status: "Flagged" },
  { unit: "Unit 401-F", occupant: "Ador Mawanay", meter: "SM-2088", kwh: "290.1", cost: "₱2,465.85", status: "Active" },
  { unit: "Unit 204-C", occupant: "Vacant", meter: "SM-2091", kwh: "0.0", cost: "₱0.00", status: "Vacant" },
  { unit: "Unit 112-D", occupant: "Patricia Lopez", meter: "SM-2102", kwh: "180.4", cost: "₱1,533.40", status: "Active" },
];

export const anomalyReadings = [
  { time: "8:45 AM", draw: "2.07 kW", vs: "+29%", note: "", flagged: false },
  { time: "9:30 AM", draw: "2.09 kW", vs: "+31%", note: "", flagged: false },
  { time: "10:00 AM", draw: "2.12 kW", vs: "+33%", note: "", flagged: false },
  { time: "10:15 AM", draw: "1.97 kW", vs: "+23%", note: "Above threshold", flagged: true },
  { time: "10:45 AM", draw: "2.78 kW", vs: "+74%", note: "Sudden jump detected", flagged: true },
  { time: "11:30 AM", draw: "3.85 kW", vs: "+141%", note: "Above threshold", flagged: true },
];

// Chart series
export const systemTrend = [10, 14, 12, 17, 23, 20, 28, 32, 30, 38, 36, 34, 41, 49, 44, 40, 51, 54, 53, 60, 64, 62, 68, 71, 69, 76, 82, 79, 86, 90];
export const analyticsTrend = [42, 38, 46, 34, 43, 39, 50, 45, 54, 48, 53, 44, 43, 51, 54, 61, 57, 62, 59, 69, 67, 73, 68, 78, 72, 76, 73, 80, 77, 84];
export const unitTrend = [40, 43, 46, 44, 46, 46, 45, 50, 55, 58, 52, 51, 53, 52, 47, 50, 53, 53, 52, 54, 56, 62, 65, 72, 60, 70, 68, 58, 66, 72];
export const userTrend = [20, 18, 32, 30, 36, 35, 48, 42, 55, 51, 62, 59, 68, 65, 72, 74];
export const loadTrend = [20, 23, 27, 24, 26, 26, 27, 26, 24, 27, 25, 21, 24, 24, 23, 25, 22, 23, 21, 18, 80, 76, 76, 70, 78];

export const peso = (n: number) =>
  "₱" + n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ---- Demo administrator records (mock data; replace with auth-provider data later) ----
export const ADMIN_ROLES = ["Admin"] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];
export type Admin = {
  id: string;
  name: string;
  email: string;
  role: AdminRole;
  status: "Active" | "Disabled";
  added: string;
};

export const admins: Admin[] = [
  { id: "ADM-001", name: "John Doe", email: "admin@kilowhat.ph", role: "Admin", status: "Active", added: "Jan 02, 2024" },
  { id: "ADM-002", name: "Mike Alvarez", email: "mike@kilowhat.ph", role: "Admin", status: "Active", added: "Feb 14, 2024" },
  { id: "ADM-003", name: "Rose Villanueva", email: "rose@kilowhat.ph", role: "Admin", status: "Active", added: "Jun 21, 2024" },
  { id: "ADM-004", name: "Paolo Navarro", email: "paolo@kilowhat.ph", role: "Admin", status: "Disabled", added: "Aug 09, 2024" },
];
