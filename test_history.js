import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function test() {
  const search = "TRUSTEES OF THE UNIVERSITY OF PENNSYLVANIA, THE";
  
  console.log('--- Test 1: Query 1 ---');
  const { data: d1, error: e1 } = await supabase
    .from('news_items')
    .select('id, title, recipients')
    .eq('is_investment', true)
    .contains('recipients', `[{"name": "${search}"}]`)
    .limit(100);
  console.log('Query 1 Result:', d1 ? d1.length : 0, 'Error:', e1 ? e1.message : null);

  console.log('--- Test 1: Query 2 ---');
  const { data: d2, error: e2 } = await supabase
    .from('news_items')
    .select('id, title, recipients')
    .eq('is_investment', true)
    .contains('recipients', `["${search}"]`)
    .limit(100);
  console.log('Query 2 Result:', d2 ? d2.length : 0, 'Error:', e2 ? e2.message : null);
}

test();
