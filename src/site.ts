import { DefaultContext, DefaultState, ExtendableContext, Next, ParameterizedContext } from 'koa';
import * as Path from 'path';
import pageManager from './page-manager';

const COOKIE_MAX_AGE = 3600 * 1000 * 24 * 360; // one year

export interface SiteConfig {
	repoUrl?: string, // git:....
	contentRepoDir: string, // e.g., './content_src/' or '../../../jeremychone-content_src'
	contentPath: string, // from contentRepoDir (e.g., 'content/')
	baseMeta?: any
}

export async function koaSite(cfg: SiteConfig) {
	const { contentRepoDir, contentPath, baseMeta } = cfg;

	const contentDir = Path.join(contentRepoDir, contentPath)

	const pm = await pageManager(contentDir);
	async function middleware(ktx: ExtendableContext, next: Next) {
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
	return middleware;
}

export function appendCookie(ktx: DefaultContext | ExtendableContext | ParameterizedContext<DefaultState, ExtendableContext>, name: string, value: string) {
	let currentValue = ktx.cookies.get(name);
	if (currentValue != null) {
		const currentVals = currentValue.split(',');
		if (!currentVals.includes(value)) {
			currentVals.push(value);
		}
		value = currentVals.join(',');
	}

	ktx.cookies.set(name, value, { maxAge: COOKIE_MAX_AGE });
}