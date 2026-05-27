import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(dirname, "../..");
const workspacePackages = {
  "@agent-core/pulseforge-agent": "shared/pulseforge-agent/src",
  "@agent-core/pulseforge-backend": "shared/pulseforge-backend/src",
  "@agent-core/pulseforge-domain": "shared/pulseforge-domain/src",
  "@agent-core/pulseforge-tools": "shared/pulseforge-tools/src",
};

const workspacePackagePlugin = {
  name: "pulseforge-workspace-packages",
  setup(buildContext) {
    buildContext.onResolve(
      { filter: /^@agent-core\/pulseforge-(agent|backend|domain|tools)(\/.*)?$/ },
      (args) => {
        const match = args.path.match(
          /^(@agent-core\/pulseforge-(?:agent|backend|domain|tools))(?:\/(.*))?$/
        );
        if (!match) {
          return undefined;
        }

        const [, packageName, subpath] = match;
        const sourceRoot = workspacePackages[packageName];
        const sourceFile = subpath ?? "index";
        const normalizedSourceFile = sourceFile
          .replace(/\.js$/, "")
          .replace(/\.ts$/, "");

        return {
          path: path.join(repoRoot, sourceRoot, `${normalizedSourceFile}.ts`),
        };
      }
    );
  },
};

const externalThirdPartyDependenciesPlugin = {
  name: "external-third-party-dependencies",
  setup(buildContext) {
    buildContext.onResolve({ filter: /^[^./]/ }, (args) => {
      if (args.path.startsWith("@agent-core/")) {
        return undefined;
      }

      return {
        path: args.path,
        external: true,
      };
    });
  },
};

await build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  outfile: "dist/index.mjs",
  plugins: [workspacePackagePlugin, externalThirdPartyDependenciesPlugin],
});
