export const ROLE_PROFILES = {
  software_developer: {
    key: "software_developer",
    label: "Software Development Instructor`",
    dressTone:
      "smart casual to business casual, clean and understated, with a practical tech-industry feel",
    demeanor:
      "focused, approachable, technically confident, and calm under pressure",
    backgroundContext:
      "a clean office, workspace, or neutral studio backdrop with minimal distractions",
  },
  sdi_mentor: {
    key: "sdi_mentor",
    label: "SDI Mentor",
    dressTone:
      "polished business casual that feels credible, approachable, and coach-like",
    demeanor:
      "supportive, articulate, trustworthy, and confident in a teaching or mentoring setting",
    backgroundContext:
      "a tidy learning, coaching, office, or neutral professional environment that feels welcoming",
  },
  hr: {
    key: "hr",
    label: "HR",
    dressTone:
      "business casual to business professional, polished, neat, and people-facing",
    demeanor:
      "warm, organized, trustworthy, and professional in a candidate-facing context",
    backgroundContext:
      "a clean office or neutral corporate backdrop that suggests professionalism and discretion",
  },
  manager: {
    key: "manager",
    label: "Manager",
    dressTone:
      "elevated business casual or business professional with a leadership-ready appearance",
    demeanor:
      "confident, composed, decisive, and credible as a leader",
    backgroundContext:
      "a refined office, meeting-room, or neutral executive-style setting with minimal clutter",
  },
  teacher: {
    key: "teacher",
    label: "Teacher",
    dressTone:
      "neat educator-professional or business casual clothing that feels approachable and put together",
    demeanor:
      "friendly, attentive, patient, and confident in an educational setting",
    backgroundContext:
      "a classroom, library, academic, or clean neutral backdrop that feels welcoming and focused",
  },
  designer: {
    key: "designer",
    label: "Designer",
    dressTone:
      "creative-professional, polished, and modern while still clearly workplace-appropriate",
    demeanor:
      "creative, thoughtful, self-assured, and visually aware without looking performative",
    backgroundContext:
      "a clean studio, creative workspace, or refined modern backdrop with strong but subtle visual polish",
  },
};

export const ROLE_OPTIONS = Object.values(ROLE_PROFILES).map((profile) => ({
  key: profile.key,
  label: profile.label,
}));

export const SUPPORTED_ROLE_KEYS = ROLE_OPTIONS.map((profile) => profile.key);

export function getRoleProfile(roleKey) {
  return ROLE_PROFILES[roleKey] || null;
}

function normalizeRoleLookup(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
}

function slugifyRole(value) {
  const normalized = normalizeRoleLookup(value)
    .replace(/[^a-z0-9 ]/g, "")
    .trim()
    .replace(/\s+/g, "_");

  return normalized || "custom_role";
}

function createRoleAliasSet(profile) {
  const aliases = new Set([
    profile.key,
    profile.key.replace(/_/g, " "),
    profile.label,
  ]);

  if (profile.key === "sdi_mentor") {
    aliases.add("sdi mentor");
  }

  return aliases;
}

function findPresetRoleProfile(roleInput) {
  const normalizedInput = normalizeRoleLookup(roleInput);

  if (!normalizedInput) {
    return null;
  }

  return (
    Object.values(ROLE_PROFILES).find((profile) =>
      Array.from(createRoleAliasSet(profile)).some(
        (alias) => normalizeRoleLookup(alias) === normalizedInput
      )
    ) || null
  );
}

export function createCustomRoleProfile(roleInput) {
  const label = String(roleInput || "").trim();

  return {
    key: slugifyRole(label),
    label,
    dressTone: `professional attire appropriate for the ${label} role, polished and credible for that field`,
    demeanor: `confident, capable, approachable, and aligned with how a strong ${label} candidate should present professionally`,
    backgroundContext: `a clean, role-appropriate professional setting that supports the ${label} context without distractions`,
  };
}

export function resolveRoleProfile(roleInput) {
  const trimmedRole = String(roleInput || "").trim();

  if (!trimmedRole) {
    return null;
  }

  return findPresetRoleProfile(trimmedRole) || createCustomRoleProfile(trimmedRole);
}
