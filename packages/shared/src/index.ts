import { z } from "zod";

/** Bump when the API contract changes in a breaking way. */
export const API_VERSION = "v1";
/** Extensions older than this are asked to update (served by GET /v1/meta). */
export const MIN_EXTENSION_VERSION = "0.1.0";

export const Role = z.enum(["viewer", "editor"]);
export type Role = z.infer<typeof Role>;

/** What the caller can do with a file. */
export const Access = z.enum(["owner", "editor", "viewer"]);
export type Access = z.infer<typeof Access>;

/**
 * The scene is stored as OPAQUE Excalidraw JSON. We only check the outer shape
 * so Excalidraw upgrades never force a data migration on us.
 */
export const Scene = z
  .object({
    type: z.literal("excalidraw"),
    version: z.number().optional(),
    source: z.string().optional(),
    elements: z.array(z.unknown()),
    appState: z.record(z.unknown()).optional(),
    files: z.record(z.unknown()).optional(),
  })
  .passthrough();
export type Scene = z.infer<typeof Scene>;

export const MAX_SCENE_BYTES = 10 * 1024 * 1024;
export const MAX_NAME_LENGTH = 200;

export const User = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  name: z.string(),
  avatar: z.string().nullable(),
});
export type User = z.infer<typeof User>;

export const Kind = z.enum(["file", "folder"]);
export type Kind = z.infer<typeof Kind>;

export const TagColor = z.enum(["gray", "red", "orange", "yellow", "green", "teal", "blue", "purple"]);
export type TagColor = z.infer<typeof TagColor>;
export const MAX_TAGS_PER_USER = 50;
export const MAX_TAGS_PER_ITEM = 20;

export const Tag = z.object({ id: z.string().uuid(), name: z.string(), color: TagColor });
export type Tag = z.infer<typeof Tag>;
export const TagWithCount = Tag.extend({ count: z.number().int() });
export type TagWithCount = z.infer<typeof TagWithCount>;

export const CreateTagBody = z.object({ name: z.string().trim().min(1).max(40), color: TagColor.optional() });
export type CreateTagBody = z.infer<typeof CreateTagBody>;
export const UpdateTagBody = z.object({ name: z.string().trim().min(1).max(40).optional(), color: TagColor.optional() }).refine((v) => v.name !== undefined || v.color !== undefined, "empty patch");
export type UpdateTagBody = z.infer<typeof UpdateTagBody>;
/** Replaces the caller's tags on one item. */
export const SetTagsBody = z.object({ tagIds: z.array(z.string().uuid()).max(MAX_TAGS_PER_ITEM) });
export type SetTagsBody = z.infer<typeof SetTagsBody>;

export const FileMeta = z.object({
  id: z.string().uuid(),
  kind: Kind,
  name: z.string(),
  ownerId: z.string().uuid(),
  ownerName: z.string(),
  parentId: z.string().uuid().nullable(),
  revision: z.number().int(),
  size: z.number().int(),
  starred: z.boolean(),
  access: Access,
  shared: z.boolean(),
  /** The caller's own tags on this item. */
  tags: z.array(Tag),
  trashed: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type FileMeta = z.infer<typeof FileMeta>;

export const FileWithScene = FileMeta.extend({ scene: Scene });
export type FileWithScene = z.infer<typeof FileWithScene>;

export const ListView = z.enum(["mine", "shared", "recent", "starred", "trash"]);
export type ListView = z.infer<typeof ListView>;

export const CreateFileBody = z.object({
  name: z.string().min(1).max(MAX_NAME_LENGTH),
  scene: Scene,
  parentId: z.string().uuid().nullable().optional(),
});
export type CreateFileBody = z.infer<typeof CreateFileBody>;

export const CreateFolderBody = z.object({
  name: z.string().min(1).max(MAX_NAME_LENGTH),
  parentId: z.string().uuid().nullable().optional(),
});
export type CreateFolderBody = z.infer<typeof CreateFolderBody>;

export const SaveFileBody = z.object({
  scene: Scene,
  name: z.string().min(1).max(MAX_NAME_LENGTH).optional(),
});
export type SaveFileBody = z.infer<typeof SaveFileBody>;

export const PatchFileBody = z
  .object({
    name: z.string().min(1).max(MAX_NAME_LENGTH).optional(),
    starred: z.boolean().optional(),
    parentId: z.string().uuid().nullable().optional(),
    trashed: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "empty patch");
export type PatchFileBody = z.infer<typeof PatchFileBody>;

export const SaveResult = z.object({ revision: z.number().int(), updatedAt: z.string() });
export type SaveResult = z.infer<typeof SaveResult>;

export const ConflictError = z.object({
  error: z.literal("conflict"),
  currentRevision: z.number().int(),
});

export const ShareEntry = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  role: Role,
  createdAt: z.string(),
});
export type ShareEntry = z.infer<typeof ShareEntry>;

export const AddShareBody = z.object({ email: z.string().email(), role: Role });
export type AddShareBody = z.infer<typeof AddShareBody>;

export const UpdateShareBody = z.object({ role: Role });
export type UpdateShareBody = z.infer<typeof UpdateShareBody>;

/** "Anyone with the link" setting for a file or folder. */
export const SetLinkBody = z.object({ enabled: z.boolean(), role: Role.optional() });
export type SetLinkBody = z.infer<typeof SetLinkBody>;

export const LinkInfo = z.object({ enabled: z.boolean(), role: Role, token: z.string().nullable() });
export type LinkInfo = z.infer<typeof LinkInfo>;

export const InheritedShare = z.object({ id: z.string().uuid(), email: z.string().email(), role: Role, fromId: z.string().uuid(), fromName: z.string() });
export type InheritedShare = z.infer<typeof InheritedShare>;

/** Everything the share dialog needs in one response. */
export const SharingInfo = z.object({
  owner: z.object({ name: z.string(), email: z.string() }),
  shares: z.array(ShareEntry),
  inherited: z.array(InheritedShare),
  link: LinkInfo,
});
export type SharingInfo = z.infer<typeof SharingInfo>;

export const PathItem = z.object({ id: z.string().uuid(), name: z.string() });
export type PathItem = z.infer<typeof PathItem>;

export const GoogleAuthBody = z.object({
  code: z.string().min(1),
  codeVerifier: z.string().min(43).max(128),
  redirectUri: z.string().url(),
});
export type GoogleAuthBody = z.infer<typeof GoogleAuthBody>;

export const RefreshBody = z.object({ refreshToken: z.string().min(1) });
export type RefreshBody = z.infer<typeof RefreshBody>;

export const AuthResult = z.object({
  accessToken: z.string(),
  accessExpiresIn: z.number().int(),
  refreshToken: z.string(),
  user: User,
});
export type AuthResult = z.infer<typeof AuthResult>;

export const Meta = z.object({
  apiVersion: z.string(),
  minExtensionVersion: z.string(),
  googleClientId: z.string(),
});
export type Meta = z.infer<typeof Meta>;

/** Compare "1.2.3"-style versions. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}
