import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL  = "https://icsauqhyroyfugacmmze.supabase.co";
const SUPABASE_KEY  = "sb_publishable_n-vsc4Na8BU0k36NxGPflQ_C-erlH6u";

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
