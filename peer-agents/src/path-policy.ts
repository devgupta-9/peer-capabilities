import path from 'node:path';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { directoryIdentity, containsDirectory, assertIdentity, type DirectoryIdentity } from './filesystem-identity.js';
import { runCapture } from './process.js';
import { WorkspaceRegistry } from './workspace-registry.js';

export type WorkspaceMode = 'AUTO_ACTIVE' | 'STRICT_ROOTS';
export type WorkspaceOperation = 'READ_ONLY' | 'REVIEW' | 'IMPLEMENT';
export type WorkspaceDecision = {
  ready: boolean; authorizationMode: 'ACTIVE_WORKSPACE' | 'ENROLLED' | 'EXPLICIT_ROOT' | 'DENIED';
  authorizationSource: 'HOST_ROOTS' | 'SERVER_CWD' | 'REGISTRY' | 'CONFIGURATION' | null;
  mode: WorkspaceMode; repository?: string; cwd?: string; gitRoot?: string;
  activeWorkspace: boolean; crossWorkspace: boolean; reason: string; nextAction?: string; error?: string;
};
export type AuthorizedWorkingDirectory = { cwd: string; gitRoot: string; allowedRoots: string[]; decision: WorkspaceDecision };
export type WorkspaceOptions = {
  allowedRoots?: string[]; serverCwd?: string; mode?: WorkspaceMode;
  deniedRoots?: string[]; registryFile?: string;
};
const envPaths = (name: string) => (process.env[name] ?? '').split(path.delimiter).map(p => p.trim()).filter(Boolean);
export function workspaceRegistryFile(): string {
  return process.env.PEER_AGENTS_WORKSPACE_REGISTRY ?? path.join(homedir(), '.peer-capabilities', 'control', 'environment.sqlite');
}
export async function workspaceRepository(cwd: string): Promise<DirectoryIdentity> {
  const dir = directoryIdentity(cwd);
  const result = await runCapture('git', ['-C', dir.canonicalPath, 'rev-parse', '--show-toplevel'], { timeoutSeconds: 15 });
  if (result.code !== 0 || result.timedOut || result.stdoutTruncated || result.stderrTruncated || !result.stdout.trim()) {
    throw new Error('Working directory must be inside a Git repository');
  }
  const root = directoryIdentity(result.stdout.trim());
  if (!containsDirectory(root, dir)) throw new Error('Working directory escaped Git repository');
  return root;
}
function sensitiveLocations(): string[] {
  const home = homedir();
  const locations = ['.ssh', '.aws', '.azure', '.codex', '.gemini', '.claude', '.gnupg', '.kube', '.config/gcloud',
    '.config/gh', '.config/opencode', '.local/share/opencode', '.peer-capabilities', '.peer-agents',
    '.mozilla', '.config/google-chrome', '.config/chromium', '.config/BraveSoftware',
    'Library/Application Support/Google/Chrome', 'Library/Application Support/Firefox', 'Library/Keychains',
    'Library/Application Support/Claude'].map(p => path.join(home, p));
  for (const value of [process.env.CODEX_HOME, process.env.CLAUDE_CONFIG_DIR, process.env.CLOUDSDK_CONFIG,
    process.env.AWS_SHARED_CREDENTIALS_FILE && path.dirname(process.env.AWS_SHARED_CREDENTIALS_FILE),
    process.env.SystemRoot, process.env.ProgramFiles, process.env['ProgramFiles(x86)']]) if (value) locations.push(value);
  if (process.env.LOCALAPPDATA) locations.push(...['Google/Chrome/User Data', 'Microsoft/Edge/User Data',
    'BraveSoftware/Brave-Browser/User Data'].map(p => path.join(process.env.LOCALAPPDATA!, p)));
  if (process.env.APPDATA) locations.push(...['Mozilla/Firefox', 'Claude', 'Antigravity', 'Code/User'].map(p => path.join(process.env.APPDATA!, p)));
  if (process.platform !== 'win32') locations.push('/etc', '/proc', '/sys', '/dev', '/boot', '/root');
  return locations;
}

/** Shared preflight/execution boundary. Host roots come from MCP transport, NEVER
 * tool arguments. undefined = unsupported; [] = host revoked all workspace roots. */
export class WorkspaceAuthorizer {
  readonly mode: WorkspaceMode;
  readonly registry: WorkspaceRegistry;
  private roots: string[];
  private denies: string[];
  private pins = new Map<string, DirectoryIdentity>();
  private startup: Promise<DirectoryIdentity | null>;
  constructor(options: WorkspaceOptions = {}) {
    this.roots = options.allowedRoots ?? envPaths('PEER_AGENTS_ALLOWED_ROOTS');
    const mode = options.mode ?? process.env.PEER_AGENTS_WORKSPACE_MODE ?? (this.roots.length ? 'STRICT_ROOTS' : 'AUTO_ACTIVE');
    if (mode !== 'AUTO_ACTIVE' && mode !== 'STRICT_ROOTS') throw new Error('Invalid workspace authorization mode');
    this.mode = mode;
    this.registry = new WorkspaceRegistry(options.registryFile ?? workspaceRegistryFile());
    this.denies = [...sensitiveLocations(), ...(options.deniedRoots ?? envPaths('PEER_AGENTS_DENIED_ROOTS'))];
    for (const root of this.roots) this.pin(root);
    const server = this.pin(options.serverCwd ?? process.cwd());
    this.startup = workspaceRepository(server.canonicalPath).then(root => {
      this.verify(server); return this.pin(root.canonicalPath);
    }).catch(() => null);
  }
  private verify(identity: DirectoryIdentity): void {
    assertIdentity(identity);
    if (directoryIdentity(identity.displayPath).key !== identity.key) throw new Error('Workspace scope/identity changed');
  }
  private pin(value: string): DirectoryIdentity {
    if (!path.isAbsolute(value)) throw new Error('Workspace path must be absolute');
    const display = path.resolve(value), previous = this.pins.get(display);
    if (previous) { this.verify(previous); return previous; }
    const identity = directoryIdentity(value); this.pins.set(display, identity); return identity;
  }
  private sensitive(identity: DirectoryIdentity): boolean {
    if (identity.key === directoryIdentity(path.parse(identity.canonicalPath).root).key || identity.key === directoryIdentity(homedir()).key) return true;
    return this.denies.some(location => existsSync(location) && containsDirectory(directoryIdentity(location), identity));
  }
  async check(requested: string, operation: WorkspaceOperation = 'READ_ONLY', hostRoots?: string[]): Promise<WorkspaceDecision> {
    const base: WorkspaceDecision = { ready: false, authorizationMode: 'DENIED', authorizationSource: null,
      mode: this.mode, activeWorkspace: false, crossWorkspace: false, reason: 'UNAUTHORIZED' };
    try {
      if (!['READ_ONLY', 'REVIEW', 'IMPLEMENT'].includes(operation)) return { ...base, reason: 'OPERATION_DENIED' };
      if (!path.isAbsolute(requested)) throw new Error('Working directory must be an absolute path');
      const cwd = directoryIdentity(requested);
      if (this.sensitive(cwd)) return { ...base, reason: 'SENSITIVE_PATH', nextAction: 'Choose a non-sensitive project repository.' };
      const repository = await workspaceRepository(cwd.canonicalPath);
      if (this.sensitive(repository)) return { ...base, reason: 'SENSITIVE_PATH', nextAction: 'Choose a non-sensitive project repository.' };
      const projects = this.registry.list();
      // Validate relevant enrollment references before any grant can borrow a
      // redirected path. A missing unrelated former project is not a dependency.
      const eligible = projects.filter(project => {
        const display = project.identity.displayPath;
        if (!existsSync(display)) return false;
        const current = directoryIdentity(display);
        if (current.key !== repository.key && project.identity.key !== repository.key) return false;
        this.verify(project.identity); return true;
      });
      const active = this.mode === 'STRICT_ROOTS' ? [] : hostRoots === undefined ? [await this.startup].filter((r): r is DirectoryIdentity => r !== null).map(root => ({ workspace: root, repository: root }))
        : await Promise.all(hostRoots.map(async root => {
          const host = this.pin(root), repo = await workspaceRepository(host.canonicalPath);
          // A broad non-Git parent never grants its child repositories; a host
          // subdirectory does not grant its parent or nested independent repos.
          return { workspace: host, repository: this.pin(repo.canonicalPath) };
        }));
      const isActive = active.some(root => {
        this.verify(root.workspace); this.verify(root.repository);
        return root.repository.key === repository.key && containsDirectory(root.workspace, cwd);
      });
      const details = { ...base, cwd: cwd.canonicalPath, repository: repository.canonicalPath, gitRoot: repository.canonicalPath,
        activeWorkspace: isActive, crossWorkspace: !isActive };
      if (eligible.some(p => !p.enabled)) return { ...details, reason: 'PROJECT_DISABLED' };
      const allow = (authorizationMode: WorkspaceDecision['authorizationMode'], authorizationSource: WorkspaceDecision['authorizationSource']) =>
        ({ ...details, ready: true, authorizationMode, authorizationSource, reason: 'AUTHORIZED' });
      if (this.mode === 'AUTO_ACTIVE' && isActive) return allow('ACTIVE_WORKSPACE', hostRoots === undefined ? 'SERVER_CWD' : 'HOST_ROOTS');
      if (this.mode === 'AUTO_ACTIVE' && eligible.some(p => p.enabled)) return allow('ENROLLED', 'REGISTRY');
      if (this.roots.some(root => containsDirectory(this.pin(root), repository))) return allow('EXPLICIT_ROOT', 'CONFIGURATION');
      return { ...details, reason: this.mode === 'STRICT_ROOTS' ? 'STRICT_ROOTS' : 'NOT_ENROLLED',
        error: this.mode === 'STRICT_ROOTS' ? 'Git repository is outside configured delegation roots'
          : 'No safe delegation root: host workspace unavailable or project not enrolled. PEER_AGENTS_ALLOWED_ROOTS is optional explicit scope.',
        nextAction: this.mode === 'STRICT_ROOTS' ? 'Ask the policy owner to change explicit roots or opt into AUTO_ACTIVE.'
          : 'Open the repository in a roots-capable host; explicitly enroll additional projects with peer-capabilities project add <path>.' };
    } catch {
      return { ...base, reason: 'INVALID_WORKSPACE', error: 'Git repository or workspace scope/identity is invalid; explicit reconciliation required.',
        nextAction: 'Check host workspace, registry integrity and filesystem identities; do not bypass policy.' };
    }
  }
  async authorize(requested: string, operation: WorkspaceOperation = 'READ_ONLY', hostRoots?: string[]): Promise<AuthorizedWorkingDirectory> {
    const decision = await this.check(requested, operation, hostRoots);
    if (!decision.ready) throw new Error(decision.error ?? decision.reason);
    return { cwd: decision.cwd!, gitRoot: decision.repository!, allowedRoots: this.roots, decision };
  }
  async enroll(requested: string): Promise<void> {
    const resolved = await workspaceRepository(requested);
    const supplied = directoryIdentity(requested);
    const root = supplied.key === resolved.key ? supplied : resolved;
    if (this.sensitive(root)) throw new Error('Cannot enroll a sensitive location');
    const now = new Date().toISOString();
    const existing = this.registry.list().find(project => project.id === root.key);
    this.registry.put({ id: root.key, identity: root, enabled: true, authorizationMode: 'ENROLLED', createdAt: existing?.createdAt ?? now, updatedAt: now });
  }
  remove(requested: string): number { return this.registry.remove(path.resolve(requested)); }
}

const policies = new Map<string, WorkspaceAuthorizer>();
export async function authorizeWorkingDirectory(requestedCwd: string, options: WorkspaceOptions = {}): Promise<AuthorizedWorkingDirectory> {
  const key = JSON.stringify({ ...options, serverCwd: options.serverCwd ?? process.cwd(), roots: options.allowedRoots ?? envPaths('PEER_AGENTS_ALLOWED_ROOTS') });
  let policy = policies.get(key);
  if (!policy) { policy = new WorkspaceAuthorizer(options); policies.set(key, policy); }
  return policy.authorize(requestedCwd);
}
