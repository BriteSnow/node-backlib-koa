import KoaRouter from '@koa/router';
import execa from 'execa';
import { mkdirs, pathExists, saferRemove } from 'fs-extra-plus';
import { ExtendableContext, Next } from 'koa';
import koaCompose from 'koa-compose';
import koaStatic from 'koa-static';
import * as Path from 'path';
import { isNotEmpty } from 'utils-min';
import pageManager from './page-manager';
import { appendCookie, COOKIE_MAX_AGE } from './utils';

const TMP_SITE_REPO_DIR = '.site-repo/';

export interface SiteConfig {
	hostname: string; // 'jeremychone.com' (ignored when access via localhost, anything else redirect)
	siteRepoDir?: string, // e.g., './content_src/' or '../../../jeremychone-content_src'
	contentPath: string, // from contentRepoDir (e.g., 'content/')
	repoUrl?: string, // git:....
	baseMeta?: any
}

export async function koaSite(cfg: SiteConfig) {

	const contentDir = await initContentDir(cfg);

	const pm = await pageManager(contentDir);
	async function pageMw(ktx: ExtendableContext, next: Next) {
		const path = (ktx.path === '/') ? '/index' : ktx.path;
		const pageMeta = await pm.get(path);
		if (pageMeta) {

			// append a value to the cookie
			if (pageMeta.appendCookies) {
				for (const key in pageMeta.appendCookies) {
					const value = pageMeta.appendCookies[key];
					appendCookie(ktx, key, value);
				}
			}

			// set the value to the cookie
			if (pageMeta.setCookies) {
				for (const key in pageMeta.setCookies) {
					let newValue = pageMeta.setCookies[key];
					ktx.cookies.set(key, newValue, { maxAge: COOKIE_MAX_AGE });
				}
			}

			const { html } = await pm.render(path);
			ktx.body = html;
			ktx.type = 'html';
		} else {
			return next();
		}
	}

	return koaCompose([
		makeRedirectMw(cfg),
		makeGithubRefreshMw(cfg),
		pageMw,
		koaStatic(contentDir)]);
}



function makeRedirectMw(cfg: SiteConfig) {

	return async (ktx: ExtendableContext, next: Next) => {
		const fwdProtocol = ktx.headers['x-forwarded-proto']; //req.header('x-forwarded-proto');
		if (fwdProtocol) {
			let newUrl: string | null = null;
			const hostname = ktx.hostname;

			if (cfg.hostname !== hostname) {
				newUrl = 'https://' + cfg.hostname + ktx.request.originalUrl;
			} else if (fwdProtocol === 'http') {
				newUrl = 'https://' + cfg.hostname + ktx.request.originalUrl;
			}
			if (newUrl) {
				ktx.response.redirect(newUrl); // by default, 302 (temporary), set ktx.reponse.status = 302
				return;
			}
		}
		return next();
	}
}


const GITHUB_REFRESH_PATH = '/github-refresh/not-so-secret-path';
const GITHUB_REFRESH_MAX_SEC = 10; // will do a maximum one github refresh per this time. 
let lastNowSec = 0;

function makeGithubRefreshMw(cfg: SiteConfig) {
	const router = new KoaRouter();

	//// github 
	router.post(GITHUB_REFRESH_PATH, async (ktx) => {
		const nowSec = process.hrtime()[0];
		if (nowSec > lastNowSec + GITHUB_REFRESH_MAX_SEC) {
			console.log(`Refreshing site-content\n`);
			try {
				await execa('git', ['pull'], { cwd: TMP_SITE_REPO_DIR });
			} catch { }
			lastNowSec = nowSec;
		} else {
			console.log('Too many github refresh request, skipping this one');
		}

		ktx.body = 'ok'; // don't give hints to potential DOS requests

	});

	return router.routes();
}



/** Initialize the site repo directory, create if git url and no siteRepoDir
 * @returns contentDir 
 */
async function initContentDir(cfg: SiteConfig) {
	const { siteRepoDir, repoUrl, contentPath } = cfg;
	let repoDir: string;

	if (isNotEmpty(siteRepoDir) && await pathExists(siteRepoDir)) {
		repoDir = siteRepoDir;
	} else if (isNotEmpty(repoUrl)) {
		await saferRemove(TMP_SITE_REPO_DIR);
		await mkdirs(TMP_SITE_REPO_DIR);
		await execa('git', ['clone', repoUrl, '.'], { cwd: TMP_SITE_REPO_DIR });
		repoDir = TMP_SITE_REPO_DIR;
	} else {
		throw new Error('site config error - cannot have siteRepodDir not defined or not exist and repoUrl empty');
	}

	return Path.join(repoDir, contentPath)
}