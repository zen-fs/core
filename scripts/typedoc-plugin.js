import { Converter, ReflectionKind } from 'typedoc';

export function load({ application }) {
	application.converter.on(Converter.EVENT_RESOLVE_BEGIN, context => {
		for (const reflection of context.project.getReflectionsByKind(ReflectionKind.Reference)) {
			context.project.removeReflection(reflection);
		}
	});
}
