import esbuild from "esbuild";
import process from "process";
import fs from "fs";
import path from "path";

const prod = process.argv[2] === "production";
const pluginDir = ".obsidian/plugins/pdf-annotator";

// Copy manifest.json and styles.css to plugin dir after build
function copyToPluginDir() {
	fs.mkdirSync(pluginDir, { recursive: true });
	for (const file of ["manifest.json", "styles.css"]) {
		if (fs.existsSync(file)) {
			fs.copyFileSync(file, path.join(pluginDir, file));
		}
	}
}

const context = await esbuild.context({
	entryPoints: ["src/main.ts"],
	bundle: true,
	external: [
		"obsidian",
		"electron",
		"@codemirror/autocomplete",
		"@codemirror/collab",
		"@codemirror/commands",
		"@codemirror/language",
		"@codemirror/lint",
		"@codemirror/search",
		"@codemirror/state",
		"@codemirror/view",
		"@lezer/common",
		"@lezer/highlight",
		"@lezer/lr",
	],
	format: "cjs",
	target: "es2021",
	logLevel: "info",
	sourcemap: prod ? false : "inline",
	treeShaking: true,
	outfile: path.join(pluginDir, "main.js"),
	minify: prod,
	define: {
		"process.env.NODE_ENV": JSON.stringify(prod ? "production" : "development"),
	},
	plugins: [{
		name: "canvas-shim",
		setup(build) {
			// pdfjs-dist tries to require('canvas') for Node.js — provide empty shim
			build.onResolve({ filter: /^canvas$/ }, () => ({
				path: "canvas",
				namespace: "canvas-shim",
			}));
			build.onLoad({ filter: /.*/, namespace: "canvas-shim" }, () => ({
				contents: "module.exports = {};",
				loader: "js",
			}));
		},
	}, {
		name: "pdfjs-worker-text",
		setup(build) {
			// Load pdf.worker.min.mjs as raw text so we can create a Blob URL
			build.onResolve({ filter: /pdf\.worker\.min\.mjs$/ }, (args) => ({
				path: path.resolve("node_modules/pdfjs-dist/build/pdf.worker.min.mjs"),
				namespace: "pdfjs-worker",
			}));
			build.onLoad({ filter: /.*/, namespace: "pdfjs-worker" }, async (args) => ({
				contents: `export default ${JSON.stringify(fs.readFileSync(args.path, "utf8"))};`,
				loader: "js",
			}));
		},
	}],
});

if (prod) {
	await context.rebuild();
	copyToPluginDir();
	process.exit(0);
} else {
	copyToPluginDir();
	await context.watch();
}
