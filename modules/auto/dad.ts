import type { GuildMember } from "discord.js";
import {
	customComments,
	customNames,
	customResponses,
	customTriggers,
	greetings,
} from "./autos-data.js";

export default function dad(
	name: string,
	_: GuildMember,
): string | readonly [string, ...(number | string)[]] {
	const split = name.split(/\b/);
	const firstName =
		split.find(
			(word) =>
				customResponses[word] ||
				customNames[word] ||
				customComments[word] ||
				customTriggers.includes(word),
		) ||
		split[0] ||
		name;

	const greeting = greetings[Math.floor(Math.random() * greetings.length)] ?? greetings[0];
	const customName = customNames[firstName] || (name.length > 50 ? firstName : name);
	const comment = customComments[firstName] || "I’m Scradd!";

	return (
		customResponses[firstName] ||
		`${greeting} ${customName}${customTriggers.includes(firstName) ? "!" : ","} ${comment}`
	);
}
