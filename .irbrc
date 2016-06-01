require "irb/completion"
require "irb/ext/save-history"

IRB.conf[:SAVE_HISTORY] = 25
IRB.conf[:HISTORY_FILE] = "#{ENV["HOME"]}/.irb-history"
IRB.conf[:AUTO_INDENT] = true
IRB.conf[:PROMPT_MODE] = :SIMPLE

class Object
  def dbg
    self.tap do |x|
      puts ">>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>"
      puts x.inspect
      puts "<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<"
    end
  end
end
