import { Kafka, type Producer, type Consumer, type SASLOptions } from 'kafkajs';
// @ts-ignore
import { generateAuthToken } from 'aws-msk-iam-sasl-signer-js';

const brokers = process.env.KAFKA_BROKERS?.split(',') || ['localhost:9092'];
const clientId = process.env.KAFKA_CLIENT_ID || 'stream-agents';
const authMethod = process.env.KAFKA_AUTH_METHOD || 'none'; // 'aws-iam', 'plain', or 'none'
const plainUser = process.env.KAFKA_SASL_USERNAME;
const plainPass = process.env.KAFKA_SASL_PASSWORD;

console.log(`Initializing Kafka client with brokers: ${brokers.join(',')} (Auth: ${authMethod})`);

const getSaslConfig = (): SASLOptions | undefined => {
  if (authMethod === 'aws-iam') {
    const region = process.env.AWS_REGION || 'us-west-2';
    
    return {
      mechanism: 'oauthbearer',
      oauthBearerProvider: async () => {
        // Generate auth token
        const result = await generateAuthToken({ region });
        return {
          value: result.token
        };
      }
    };
  }
  if (authMethod === 'plain') {
    if (!plainUser || !plainPass) {
      throw new Error('KAFKA_SASL_USERNAME and KAFKA_SASL_PASSWORD are required for KAFKA_AUTH_METHOD=plain');
    }
    return {
      mechanism: 'plain',
      username: plainUser,
      password: plainPass,
    };
  }
  return undefined;
};

const kafkaConfig: any = {
  clientId,
  brokers,
  ssl: authMethod === 'aws-iam', // IAM requires SSL
  connectionTimeout: 10000,
  authenticationTimeout: 10000,
  retry: {
    initialRetryTime: 500,
    retries: 8
  }
};

const sasl = getSaslConfig();
if (sasl) {
  kafkaConfig.sasl = sasl;
}

const kafka = new Kafka(kafkaConfig);

let producer: Producer | null = null;

export const getKafka = () => kafka;

export const getProducer = async (): Promise<Producer> => {
  if (producer) return producer;
  
  producer = kafka.producer();
  await producer.connect();
  return producer;
};

export const createConsumer = async (groupId: string): Promise<Consumer> => {
  const consumer = kafka.consumer({ groupId });
  await consumer.connect();
  return consumer;
};

export const disconnectKafka = async () => {
  if (producer) {
    await producer.disconnect();
    producer = null;
  }
};
