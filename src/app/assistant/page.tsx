import {PageHeading} from '@/components/ui';
import {AssistantChat} from '@/components/assistant-chat';

export const metadata={title:'Ask SportsEdge',description:'Ask about sports, stocks, independent Kalshi weather research and automation.'};

export default function AskPage(){
 return <>
  <PageHeading title="Ask SportsEdge" description="Ask about sports picks, stock PAPER accounts, independent Kalshi weather research, and automation. All answers use recorded evidence. Sign in for private account details."/>
  <AssistantChat/>
 </>;
}
