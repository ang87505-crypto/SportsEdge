import {PageHeading} from '@/components/ui';
import {AssistantChat} from '@/components/assistant-chat';

export const metadata={title:'Ask SportsEdge',description:'Ask about sports picks, stock paper accounts, research and automation.'};

export default function AskPage(){
 return <>
  <PageHeading title="Ask SportsEdge" description="Sports picks, stock accounts, research and automation in one conversation. Answers use recorded evidence. Sign in on the Paper account page for private stock details."/>
  <AssistantChat/>
 </>;
}
