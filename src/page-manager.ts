
import chokidar from 'chokidar';
// import { PROD, SITE_CDN, URL_SITE } from 'common/conf';
import * as fs from 'fs-extra-plus';
import Handlebars from 'handlebars';
import jsyaml from 'js-yaml';
import markdownIt from 'markdown-it';
import Path from 'path';

const DEFAULT_PAGE_EXTS = ['.html', '.hmd'];
const DEFAULT_PART_EXT = '.hbs';


const md = markdownIt({ html: true, langPrefix: "" });

export interface FileMeta {
	// cdnUrl: string; // cdn url
	// hostUrl: string; // url of the website
	// prod: boolean; // prod if domain is briteboard
	md: boolean; // default true, tell if the file should be mardown processed
	hbs: boolean; // default true, tell if the file should be handlebar processed
	name: string; // final path name (without extension)
	path: string; // the path of the page (default to the file path without extension)
	file: string; // file name relative to rootDir
	dir: string; // folder path of the file, relative to rootDir
	rootDir: string; // rootDir
	type?: string; // 
	frames?: string[];
	reqPath?: string; // the default req path, can be overriden by the page. Must start with /
	title?: string; // override of the page title
	bodyCss?: string; // the body class name to be added
	actions?: { [key: string]: string }; // optional list of action to be preformed. The value is the function name
	results?: { [key: string]: any }; // result of the action executions put by same name
	redirect?: string; // if this page needs to be redirect
	setCookies?: { [name: string]: string }; // set the cookie value for the name. Disregard eventual previous value
	appendCookies?: { [name: string]: string }; // set or append a cookie value for the name (when add, use ',' as separator, only if not already in the list)

}

interface Page extends FileMeta {
	content: string; // set before render
}

/**
 * For frame, we store the html/head in memory as they will be used a lot
 */
interface Part extends FileMeta {
	key: string; // page.file without extension
	content: string;
	head?: string;
}

class PageManager {
	private _init = false;
	private _rootDir: string;

	/**
	 * pageMeta.file by pageMeta.path 
	 * (this allows to have multiple paths, but also to use the pageMeta.file as the canonical key to store the pageMeta in this.pages)
	 */
	private fileByPath: Map<string, string> = new Map();

	/** 
	 * pageMeta by pageMeta.file (which could be overriden) 
	 * 
	 */
	private pages: Map<string, FileMeta> = new Map();

	/**
	 * part by Part.key (which is .file without extension egg `part/header` for `part/header.hbs`)
	 */
	private parts: Map<string, Part> = new Map();

	private _handlebars: typeof Handlebars;

	constructor(rootDir: string) {
		this._rootDir = rootDir;
		this._handlebars = this.buildHandlebars();
	}

	//#region    ---------- Init ---------- 
	async init() {
		if (this._init) {
			throw new Error(`Already initialized. Can't initialize twice`);
		}
		await this.refreshAll();
		this.watch();
		this._init = true;
	}

	watch() {
		//// Watch pages
		const pagePattern = DEFAULT_PAGE_EXTS.map(ext => `${this._rootDir}/**/*${ext}`);
		const pageWatcher = chokidar.watch(pagePattern, { depth: 99, ignoreInitial: true, persistent: true });
		const pageSaveHandler = async (fullFile: string) => { this.loadPage(fullFile) };
		pageWatcher.on('add', pageSaveHandler);
		pageWatcher.on('change', pageSaveHandler);

		//// Watch parts
		const partPattern = `${this._rootDir}/**/*${DEFAULT_PART_EXT}`;
		const partWatcher = chokidar.watch(partPattern, { depth: 99, ignoreInitial: true, persistent: true });
		const partSaveHandler = async (fullFile: string) => { this.loadPart(fullFile) };
		partWatcher.on('add', partSaveHandler);
		partWatcher.on('change', partSaveHandler);
	}

	/** Reparse all contents */
	async refreshAll() {
		//// Load Pages
		// recreate cache if exist
		if (this.pages.size > 0) {
			this.pages = new Map();
			this.fileByPath = new Map();
		}
		const pagePattern = DEFAULT_PAGE_EXTS.map(ext => `${this._rootDir}/**/*${ext}`);
		const pageFiles = await fs.glob(pagePattern);
		for (const fullFile of pageFiles) {
			await this.loadPage(fullFile);
		}

		///// Load Parts (including frames)
		if (this.parts.size > 0) {
			this.parts = new Map();
		}
		const partFiles = await fs.glob(Path.join(this._rootDir, `**/*${DEFAULT_PART_EXT}`));
		for (const fullFile of partFiles) {
			await this.loadPart(fullFile)
		}
	}

	async loadPage(fullFile: string) {
		const rootDir = this._rootDir;

		const file = Path.relative(rootDir, fullFile);
		const { meta } = await extractMetaAndContent(rootDir, file, true);
		if (!meta.frames) {
			const frames = await findFrames(meta.rootDir, meta.file);
			meta.frames = frames;
		}
		this.fileByPath.set(meta.path, meta.file);

		// always set md to false for html page
		if (fullFile.endsWith('.html')) {
			meta.md = false;
		}

		this.pages.set(meta.file, meta);
	}

	async loadPart(fullFile: string) {
		const rootDir = this._rootDir;
		const file = Path.relative(rootDir, fullFile);
		const { content, meta } = await extractMetaAndContent(rootDir, file, true);
		const key = keyFromFile(file);

		const part: Part = Object.assign(meta, { key, content });
		this.parts.set(key, part);
	}
	//#endregion ---------- /Init ---------- 

	//#region    ---------- Handlebars ---------- 
	private hbsCompile(content: string): (data: any) => string {
		return this._handlebars.compile(content, { noEscape: true });
	}

	private buildHandlebars() {
		const handlebars = Handlebars.create();


		// includeNext (this is what reander the .hmd)
		handlebars.registerHelper('includeNext', (options: any) => {
			// Note: by design, all render use the page as data for now, so safe assumption
			const page = options.data.root as Page;
			return this.renderNext(page);
		});

		handlebars.registerHelper('include', (path: string, options: any) => {
			const part = this.parts.get(path);
			if (part) {
				const tmpl = this.hbsCompile(part.content);
				const page = options.data.root as Page;
				return tmpl(page);
			} else {
				return `<div> NO PART FOUND FOR PATH ${path}</div>`;
			}

		});

		// stringify 
		handlebars.registerHelper('stringify', function (this: any, value: string, options: any) {
			return JSON.stringify(value);
		});

		return handlebars;
	}

	//#endregion ---------- /Handlebars ---------- 

	//#region    ---------- Runtime ---------- 
	async get(path: string): Promise<FileMeta | undefined> {
		try {
			return this.getPageMetaForPath(path);
		} catch (ex) {
			return undefined;
		}
	}

	/** Render a path page */
	async render(path: string): Promise<{ html: string }> {

		//// load page
		// clone meta as it will be changed (the .frames for example). 
		// TODO: use deepClone
		const _meta = this.getPageMetaForPath(path);
		const { content } = await extractMetaAndContent(_meta.rootDir, _meta.file, false);
		const page = JSON.parse(JSON.stringify(_meta)) as Page;
		page.content = content;

		// render page
		const html = await this.renderNext(page);

		return { html };
	}

	private renderNext(page: Page) {
		const frameKey = page?.frames?.pop();
		const part = (frameKey) ? this.parts.get(frameKey) : undefined;

		// If we have a part, we render the part, assuming it will have the {{includeNext}}
		if (part) {
			const tmpl = this.hbsCompile(part.content);
			return tmpl(page);
		}
		// If no part, assume it is the last render of the page
		else {
			const tmpl = this.hbsCompile(page.content);
			let html = tmpl(page);
			if (page.md) {
				html = md.render(html);
			}
			return html;
		}
	}


	//#endregion ---------- /Runtime ---------- 

	private getPageMetaForPath(path: string) {
		const file = this.fileByPath.get(path);

		if (file == null) {
			throw new Error(`Can't find matching file for path: ${path}`);
		}
		const meta = this.pages.get(file);
		if (meta == null) {
			throw new Error(`Can't find pageMeta for path: ${path} (file: ${file})`);
		}

		return meta;
	}
}


//#region    ---------- PageManager Factory ---------- 
/** Create and initialize a new PageManager for a given rootDir */
export default async function pageManager(rootDir: string): Promise<PageManager> {
	const pm = new PageManager(rootDir);
	await pm.init();

	return pm;
}
//#endregion ---------- /PageManager Factory ---------- 


//#region    ---------- PageMeta Builder Utils ---------- 
/**
 * 
 * @param file Relative to opts.rootDir
 */
function extractMetaAndContent<B extends boolean>(rootDir: string, file: string, parseMeta: B): B extends true ? Promise<{ content: string, head?: string, meta: FileMeta }> : Promise<{ content: string, head?: string }>
async function extractMetaAndContent(rootDir: string, file: string, parseMeta = true): Promise<{ content: string, meta?: FileMeta }> {
	const fileWithRoot = Path.join(rootDir, file);

	// get the page content
	const full_content = (await fs.readFile(fileWithRoot, 'utf8')).trim();
	let content = full_content;
	let yamlStr: string | undefined = undefined;

	if (full_content.startsWith('```yaml')) {
		const startYamlIdx = '```yaml'.length;
		const endYamlIdx = content.indexOf('```', startYamlIdx);
		yamlStr = content.substring(startYamlIdx, endYamlIdx).trim();
		content = content.substring(endYamlIdx + '```'.length).trim();
	}

	if (parseMeta) {
		// put the folder
		const fileInfo = Path.parse(file);
		const name = fileInfo.name;
		const path = `${fileInfo.dir}/${name}`;
		const dir = fileInfo.dir;

		// if the content have some data (i.e., start with some data)
		let meta: FileMeta = {
			// cdnUrl: SITE_CDN,
			// hostUrl: URL_SITE,
			// prod: PROD,
			md: true,
			hbs: true,
			name,
			path,
			rootDir,
			file,
			dir,
		};

		if (yamlStr) {
			const data = jsyaml.load(yamlStr)!;
			// adding the {name,...} to make sure they are not overrided by data
			Object.assign(meta, data, { name, rootDir, file, dir });
		}

		return { content, meta };
	} else {
		return { content };
	}




}

async function findFrames(rootDir: string, file: string): Promise<string[]> {
	const frames: string[] = [];

	// NOTE: not sure needed

	let dir = Path.dirname(Path.join(rootDir, file));
	for (; true;) {
		const fullFile = Path.join(dir, `_frame${DEFAULT_PART_EXT}`);

		if ((await fs.pathExists(fullFile))) {
			const key = keyFromFile(Path.relative(rootDir, fullFile));
			frames.push(key);
		}

		// if the dir is the rootDir, we stop
		if (!dir || dir === "/" || dir === rootDir) {
			break;
		}



		// get the parent dir
		dir = Path.resolve(Path.join(dir, '../'));
	}

	return frames;
}


function keyFromFile(file: string) {
	return '/' + file.substring(0, file.length - DEFAULT_PART_EXT.length);
}

//#endregion ---------- /PageMeta Builder Utils ---------- 

