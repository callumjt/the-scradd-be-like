import {
	ApplicationCommandOptionType,
	ButtonStyle,
	ComponentType,
	GuildMember,
	User,
	ChatInputCommandInteraction,
	ButtonInteraction,
} from "discord.js";
import config from "../../common/config.js";
import constants from "../../common/constants.js";
import { getLevelForXp, xpDatabase } from "./misc.js";
import { paginate } from "../../util/discord.js";
import { getSettings, mentionUser } from "../settings.js";
import { client, defineSubcommands, defineEvent, defineButton, defineSelect } from "strife.js";
import getUserRank from "./rank.js";
import { giveXpForMessage } from "./giveXp.js";

defineEvent("messageCreate", async (message) => {
	if (message.guild?.id !== config.guild.id) return;

	await giveXpForMessage(message);
});

defineSubcommands(
	{
		name: "xp",
		description: "Commands to view users’ XP amounts",

		subcommands: {
			rank: {
				description: "View a user’s XP rank",

				options: {
					user: {
						type: ApplicationCommandOptionType.User,
						description: "User to view (defaults to you)",
					},
				},
			},

			top: {
				description: "View the server XP leaderboard",

				options: {
					user: {
						type: ApplicationCommandOptionType.User,
						description: "User to jump to",
					},
				},
			},
			...(process.env.CANVAS !== "false" && {
				graph: {
					description: "Graph users’ XP over the last week",
					options: {},
				} as const,
			}),
		},
	},

	async (interaction, options) => {
		switch (options?.subcommand) {
			case "rank": {
				const user =
					options.options.user instanceof GuildMember
						? options.options.user.user
						: options.options.user ?? interaction.user;
				await getUserRank(interaction, user);
				return;
			}
			case "graph": {
				return await interaction.reply({
					components: [
						{
							type: ComponentType.ActionRow,
							components: [
								{
									type: ComponentType.UserSelect,
									placeholder: "Select users",
									customId: "_weeklyXpGraph",
									maxValues: 7,
								},
							],
						},
					],
				});
			}
			case "top": {
				await top(interaction, options.options.user);
			}
		}
	},
);
defineButton("xp", async (interaction, userId = "") => {
	await getUserRank(interaction, await client.users.fetch(userId));
});

defineButton("viewLeaderboard", async (interaction, userId) => {
	await top(interaction, await client.users.fetch(userId));
});

if (process.env.CANVAS !== "false") {
	const { default: weeklyXpGraph } = await import("./graph.js");
	defineSelect("weeklyXpGraph", weeklyXpGraph);
}

export async function top(
	interaction: ChatInputCommandInteraction<"raw" | "cached"> | ButtonInteraction,
	user?: User | GuildMember,
) {
	const top = xpDatabase.data.toSorted((one, two) => two.xp - one.xp);

	const index = user ? top.findIndex(({ user: id }) => id === user.id) : undefined;
	if (index === -1) {
		return await interaction.reply({
			content: `${
				constants.emojis.statuses.no
			} ${user?.toString()} could not be found! Do they have any XP?`,

			ephemeral: true,
		});
	}

	await paginate(
		top,
		async (xp) =>
			`**Level ${getLevelForXp(Math.abs(xp.xp)) * Math.sign(xp.xp)}** - ${await mentionUser(
				xp.user,
				interaction.user,
			)} (${Math.floor(xp.xp).toLocaleString("en-us")} XP)`,
		(data) => interaction.reply(data),
		{
			title: "XP Leaderboard",
			singular: "user",

			user: interaction.user,
			rawOffset: index,
			ephemeral:
				interaction.isButton() &&
				interaction.message.interaction?.user.id !== interaction.user.id,

			generateComponents() {
				return getSettings(interaction.user, false).useMentions === undefined
					? [
							{
								customId: "levelUpPings_toggleSetting",
								type: ComponentType.Button,
								label: "Toggle Mentions",
								style: ButtonStyle.Success,
							},
					  ]
					: undefined;
			},
			customComponentLocation: "below",
		},
	);
}
