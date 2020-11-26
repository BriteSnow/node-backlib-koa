import { DefaultContext, DefaultState, ExtendableContext, ParameterizedContext } from 'koa';

export const COOKIE_MAX_AGE = 3600 * 1000 * 24 * 360; // one year

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