export const CATEGORIES = [
  "Roads & potholes",
  "Street lighting",
  "Waste & litter",
  "Water & drainage",
  "Sidewalks & access",
  "Parks & public spaces",
  "Other",
] as const;

export const STATUSES = ["REPORTED", "IN_PROGRESS", "RESOLVED"] as const;

export type Category = (typeof CATEGORIES)[number];
export type ReportStatus = (typeof STATUSES)[number];

export type Report = {
  reportId: string;
  title: string;
  description: string;
  category: Category;
  locationLabel: string;
  latitude?: number;
  longitude?: number;
  status: ReportStatus;
  createdAt: string;
  updatedAt: string;
  photoUrl?: string;
  photoKey?: string;
};

export type ReportPage = {
  items: Report[];
  nextToken?: string;
};

export type NewReport = Pick<Report, "title" | "description" | "category" | "locationLabel"> & {
  latitude?: number;
  longitude?: number;
};
