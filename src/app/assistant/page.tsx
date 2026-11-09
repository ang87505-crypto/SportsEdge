import {PageHeading} from '@/components/ui';
import {AssistantChat} from '@/components/assistant-chat';

export const metadata={title:'Ask · SportsEdge',description:'Ask about tonight\'s PrizePicks paper picks, results, players and the model.'};

export default function AskPage(){
 return <>
  <PageHeading title="Ask" description="Ask about tonight's picks, how a night went, your record, a player, or the model. Free and read-only: it answers from your own records."/>
  <AssistantChat/>
 </>;
}
