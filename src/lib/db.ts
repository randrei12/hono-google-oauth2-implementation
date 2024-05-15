import { MongoClient } from "mongodb";

export type User = {
    id: string,
    email: string,
    verfied_email: boolean,
    name: string,
    given_name: string,
    picture: string,
    locale: string,
    created: Date
}

export const client = new MongoClient(process.env.MONGODB_DATABASE!);
export const db = client.db();

export async function doesCollectionExist(collectionName: string) {
    const collections = await db.listCollections().toArray();
    return collections.some(collection => collection.name === collectionName);
}

export const usersCollection = db.collection<User>("users");
export const sessionsCollection = db.collection("sessions");

if (!await doesCollectionExist("sessions")) {
    await sessionsCollection.createIndex(["created"], { expireAfterSeconds: 3600 * 24 * 90 });
}