// Invite link: https://discord.com/oauth2/authorize?client_id=754900762001277088&scope=bot&permissions=67423296

const fs = require('fs');
const Discord = require('discord.js');
const config = require('./config.json');
const Keyv = require('keyv');
let CronJob = require('cron').CronJob;
const parse = require('csv-parse');
const fetch = require('node-fetch');
const puppeteer = require('puppeteer');

const client = new Discord.Client();
client.guild_channels = new Keyv('sqlite://guild_channels.sqlite');
client.covid_data = null;
client.covid_graph = null;
client.last_fetched = null;

const DATA_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vTwXSqlP56q78lZKxc092o6UuIyi7VqOIQj6RM4QmlVPgtJZfbgzv0a3X7wQQkhNu8MFolhVwMy4VnF/pub?gid=0&single=true&output=csv';
const GRAPH_URL = 'https://public.tableau.com/views/Cases_15982342702770/DashboardPage?%3Aembed=y&%3AshowVizHome=no&%3Adisplay_count=y&%3Adisplay_static_image=y&%3AbootstrapWhenNotified=true&%3Alanguage=en&:embed=y&:showVizHome=n&:apiID=host2#navType=0&navSrc=Parse';

function sum(array, index) {
	let total = 0;
	for (let i = 0; i < array.length; i++) {
		total += parseInt(array[i][index]);
	}
	return total;
}

function generate_embed() {
	let new_cases = sum(client.covid_data, 5);
	let total_cases = sum(client.covid_data, 3);
	let active_cases = sum(client.covid_data, 2);
	let recovered = total_cases - active_cases;

	let embed = new Discord.MessageEmbed()
		.setColor('#007780')
		.setAuthor('DHHS', 'https://media-exp1.licdn.com/dms/image/C560BAQGt11zjLw8Slg/company-logo_200_200/0?e=2159024400&v=beta&t=GbAla80PMonJphpjnr7s-avj6Oo2-zTHAanmGJHplf4')
		.setTitle('Lastest COVID data')
		.setURL('https://www.dhhs.vic.gov.au/victorian-coronavirus-covid-19-data')
		.attachFiles([{
			name: 'graph.png',
			attachment: client.covid_graph,
		}])
		.setImage('attachment://graph.png')
		.addField('New cases', new_cases, true)
		.addField('Total cases', total_cases, true)
		.addField('Active cases', active_cases, true)
		.addField('Recovered', recovered, true);
	return embed;
}

async function broadcast(guild, embed) {
	let channel_id = await client.guild_channels.get(guild.id);
	if (channel_id) {
		try {
			const channel = guild.channels.cache.find(ch => ch.id === channel_id);
			await channel.send('Hello fellow Victorians,', embed);
			console.log(`Sending to ${guild.name}`);
		} catch (e) {
			console.log(`Failed to send to ${guild.name}`, e);
		}
	} else {
		console.log(`${guild.name} hasn't set a broadcast channel`);
	}
}

function update_data(callback = null) {
	let now = new Date();
	if (client.last_fetched == null || (now - client.last_fetched) > (2*60*60*1000)) { // More than 2 hours old
		client.last_fetched = now;
		console.log('Fetching data');
		fetch(DATA_URL).then(res => res.text()).then(csv => {
			parse(csv, async (err, output) => {
				console.log(JSON.stringify(output.shift(), null, 2));
				client.covid_data = output;

				console.log('Fetching graph');
				const browser = await puppeteer.launch({'args': ['--no-sandbox', '--disable-setuid-sandbox']});
				const page = await browser.newPage();
				await page.goto(GRAPH_URL);
				await page.waitForSelector('#main-content');
				const graphEl = await page.$('#main-content');
				client.covid_graph = await graphEl.screenshot({type: 'png'});
				console.log('Data fetch complete');

				if (callback)
					callback();
			});
		}).catch(console.error);
	} else {
		console.log('Data less than 2 hours old, not updating');
		if (callback)
			callback();
	}
}

client.on('ready', () => {
	console.log(`Logged in as ${client.user.tag}!`);
	client.user.setActivity('with my fellow Victorians');

	update_data();

	let job = new CronJob(
		config.schedule,
		function() {
			update_data(() => {
				console.log("Sending daily numbers");
				let embed = generate_embed();
				let promises = [];
				client.guilds.cache.each(guild => {
					promises.push(broadcast(guild, embed));
				});
				console.log(`Loaded ${promises.length} guilds`);
				Promise.all(promises).then(() => {
					console.log(`Done`);
				}).catch(() => {
					console.log(`Error while executing promises`);
				});
			});
		},
		null,
		true,
	);
});

client.on('guildCreate', guild => {
	console.log(`Joined ${guild.name}`);
	guild.systemChannel.send('Hello fellow Victorians\n\nUse `!da [channel_id]` to set a channel where daily updates should be posted, or just `!da` to get the current numbers');
});

client.on('message', async message => {
	if (message.author.bot) return;

	if (message.content.startsWith('!da')) {
		const args = message.content.replace('!da', '').trim().split(/ +/);
		let command = '';
		if (args.length > 0) {
			command = args.shift().toLowerCase();
		}

		if (command.length == 18) { // Channel ID
			try {
				await client.guild_channels.set(message.guild.id, command);
				message.channel.send(`Set <#${command}> as broadcast channel.`);
			} catch (e) {
				console.log('Failed to set channel as broadcast channel: ', e);
				message.channel.send(`Failed to set <#${command}> as broadcast channel, please try again.`);
			}
		} else {
			//message.channel.send("Use `!da [channel_id]` to set the broadcast channel.");
			let embed = generate_embed();
			message.channel.send('Hello fellow Victorians,', embed);
		}
	}
});

client.login(config.token);
